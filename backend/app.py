import json
import logging
import os
import sys
import time
import hashlib
import math
from functools import lru_cache
from pathlib import Path

# --- RENDER MODULE PATH FIX ---
BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import redis

# Configure logging format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("kohler_backend")

env_path = Path(__file__).resolve().parent / ".env"
logger.info(f"Loading environment from {env_path} (exists: {env_path.exists()})")
load_dotenv(dotenv_path=env_path, override=True)

from recommender import get_llm_recommendation, generate_json, DEFAULT_MODEL
from response_cache import ResponseCache

response_cache = ResponseCache()

app = Flask(__name__)

# --- GLOBAL CORS FIX ---
CORS(app, resources={r"/*": {"origins": "*"}})

# Initialize Rate Limiter (Protects token usage from spam/abuse)
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://"
)

# Local caching is always available. Connect to external Redis only when it is
# configured, and lazily on the first request rather than delaying startup.
redis_client = None
if os.getenv("REDIS_URL"):
    redis_client = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True,
        socket_connect_timeout=0.25, socket_timeout=0.25, retry_on_timeout=False)


@lru_cache(maxsize=4)
def _read_catalog(path, modified):
    with Path(path).open(encoding="utf-8") as catalog_file:
        return json.load(catalog_file)


def load_raw_catalog():
    """Search for products.json across all possible deployment paths safely with a default fallback."""
    possible_paths = [
        Path(__file__).resolve().parent / "data" / "products.json",
        Path(__file__).resolve().parent.parent / "data" / "products.json",
        Path(__file__).resolve().parent / "products.json",
        Path.cwd() / "data" / "products.json",
        Path.cwd() / "backend" / "data" / "products.json",
        Path.cwd() / "products.json",
    ]
    for p in possible_paths:
        if p.exists():
            try:
                data = _read_catalog(str(p), p.stat().st_mtime_ns)
                if isinstance(data, dict):
                    return data
            except Exception as e:
                logger.error(f"Found catalog at {p} but failed to read: {e}")
                
    logger.error("products.json not found in any path. Returning safe fallback catalog.")
    return {
        "faucets": [],
        "toilets": [],
        "showers": [],
        "vanities": [],
        "bathtubs": []
    }


def make_cache_key(prefix, values, catalog):
    # Changing the catalog or starting product bundle must invalidate old results.
    payload = json.dumps([values, catalog, os.getenv("GEMINI_MODEL", DEFAULT_MODEL)], sort_keys=True, separators=(',', ':'))
    return prefix + ':' + hashlib.sha256(payload.encode()).hexdigest()


def get_cached_response(key):
    global redis_client
    cached = response_cache.get(key)
    if cached is not None:
        return cached
    if redis_client is not None:
        try:
            value = redis_client.get(key)
            if value:
                cached = json.loads(value)
                response_cache.set(key, cached)
                return cached
        except Exception:
            logger.warning("Redis unavailable; continuing with local response cache.")
            redis_client = None
    return None


def cache_response(key, result):
    global redis_client
    response_cache.set(key, result)
    if redis_client is not None:
        try:
            redis_client.setex(key, 3600, json.dumps(result))
        except Exception:
            redis_client = None


def constraint_filter(width_ft, depth_ft, budget, style):
    """Return catalog products that fit the room dimensions and budget threshold."""
    catalog = load_raw_catalog()

    room_width_in = (width_ft or 0) * 12
    room_depth_in = (depth_ft or 0) * 12
    filtered_catalog = {
        "faucets": [],
        "toilets": [],
        "showers": [],
        "vanities": [],
        "bathtubs": []
    }

    for category in filtered_catalog:
        for product in catalog.get(category, []):
            fp = product.get("footprint_in", {"width": 0, "depth": 0})
            if (
                product.get("price", 0) <= budget
                and fp.get("width", 0) <= room_width_in
                and fp.get("depth", 0) <= room_depth_in
            ):
                filtered_catalog[category].append(product)

    counts = {k: len(v) for k, v in filtered_catalog.items()}
    logger.info(f"Constraint filtering results: {counts}")
    return filtered_catalog


def prune_catalog_context(filtered_candidates):
    """Token Pruning Utility: Strips out verbose descriptions, heavy metadata, 
       and unnecessary keys to minimize input token count before sending to Gemini.
    """
    pruned_summary = {}
    for cat, items in filtered_candidates.items():
        pruned_summary[cat] = [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "price": p.get("price"),
                "finish": p.get("finish"),
                "flow_rate": p.get("flow_rate")
            }
            for p in items
        ]
    return pruned_summary


def hydrate_bundle_items(bundle_dict, catalog):
    """Map product IDs to full catalog objects, ensuring local catalog image_url mapping."""
    detailed = {}
    total = 0

    fallback_metadata = {
        "faucet": {
            "price": 380,
            "image": "/images/faucet1.png",
            "flow_rate": "1.2 GPM",
            "finish": "Brushed Moderne Brass"
        },
        "toilet": {
            "price": 550,
            "image": "/images/toilet1.png",
            "flow_rate": "1.28 GPF",
            "finish": "White Porcelain"
        },
        "shower": {
            "price": 620,
            "image": "/images/shower1.png",
            "flow_rate": "1.75 GPM",
            "finish": "Matte Black"
        },
        "vanity": {
            "price": 850,
            "image": "/images/vanity1.png",
            "flow_rate": "Cabinetry Spec",
            "finish": "Flannel Grey"
        },
        "bathtub": {
            "price": 1200,
            "image": "/images/tub1.png",
            "flow_rate": "65 Gal Capacity",
            "finish": "White Acrylic"
        }
    }

    for category_singular, product_id in (bundle_dict or {}).items():
        cat_key = {"faucet": "faucets", "toilet": "toilets", "shower": "showers",
                   "vanity": "vanities", "bathtub": "bathtubs"}.get(category_singular, category_singular)
        matched = next((p for p in catalog.get(cat_key, []) if p.get("id") == product_id), None)

        if matched:
            item_copy = dict(matched)
            if not item_copy.get("image_url"):
                item_copy["image_url"] = f"/images/{category_singular}1.png"
            detailed[category_singular] = item_copy
            total += item_copy.get("price", 0)
        else:
            meta = fallback_metadata.get(category_singular, {
                "price": 450,
                "image": f"/images/{category_singular}1.png",
                "flow_rate": "WaterSense Certified",
                "finish": "Matte Black"
            })
            detailed[category_singular] = {
                "id": product_id,
                "name": f"Kohler {category_singular.title()}",
                "price": meta["price"],
                "finish": meta["finish"],
                "flow_rate": meta["flow_rate"],
                "image_url": meta["image"],
                "features": [
                    "Solid architectural construction",
                    "Optimized water stewardship",
                    "Standard Kohler warranty"
                ]
            }
            total += meta["price"]

    return detailed, total


@app.route("/health", methods=["GET"])
def health():
    logger.info("Health check ping received.")
    return jsonify({"status": "ok"})


@app.route("/api/catalog", methods=["GET"])
def get_full_catalog():
    """Returns the full catalog separated by categories for the archive explorer."""
    catalog = load_raw_catalog()
    return jsonify(catalog)


@app.route("/recommend", methods=["POST", "OPTIONS"])
@app.route("/api/recommend", methods=["POST", "OPTIONS"])
@limiter.limit("5 per minute")  # Rate limit AI requests to protect tokens
def recommend():
    if request.method == "OPTIONS":
        return jsonify({"status": "preflight ok"}), 200

    start_time = time.time()
    data = request.get_json() or {}

    try:
        width_ft = float(data.get("width_ft", data.get("width", 8)))
        depth_ft = float(data.get("depth_ft", data.get("depth", 6)))
        budget = float(data.get("budget", 3000))
        if not all(math.isfinite(value) and value > 0 for value in (width_ft, depth_ft, budget)):
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"error": "Room dimensions and budget must be positive numbers."}), 400
    style = data.get("style", "Minimalist Modern")
    eco_mode = bool(data.get("eco_mode", False))

    logger.info(f"Incoming baseline recommendation request: {width_ft}x{depth_ft}ft, Budget: ${budget}, Style: '{style}', EcoMode: {eco_mode}")

    catalog = load_raw_catalog()
    cache_key = make_cache_key("rec", [width_ft, depth_ft, budget, style, eco_mode], catalog)
    cached_res = get_cached_response(cache_key)
    if cached_res is not None:
        logger.info("Serving cached recommendation.")
        return jsonify(cached_res)

    candidate_budget_ceiling = budget * 1.5
    filtered_candidates = constraint_filter(width_ft, depth_ft, candidate_budget_ceiling, style)

    logger.info("Dispatching filtered candidates to recommendation engine...")
    result = get_llm_recommendation(filtered_candidates, style, budget, eco_mode=eco_mode)

    if "error" in result:
        elapsed = round(time.time() - start_time, 2)
        logger.error(f"Recommendation failed after {elapsed}s: {result['error']}")
        return jsonify(result), 400

    if "tiers" in result:
        for tier_key, tier_data in result["tiers"].items():
            detailed, total_calc = hydrate_bundle_items(tier_data.get("bundle", {}), catalog)
            tier_data["detailed_bundle"] = detailed
            if total_calc > 0:
                tier_data["total_price"] = total_calc

        default_tier = result["tiers"].get("curated") or result["tiers"].get("essential") or next(iter(result["tiers"].values()))
        result["bundle"] = default_tier.get("bundle", {})
        result["detailed_bundle"] = default_tier.get("detailed_bundle", {})
        result["total_price"] = default_tier.get("total_price", 0)
        result["explanation"] = default_tier.get("explanation", "")
    else:
        detailed, total_calc = hydrate_bundle_items(result.get("bundle", {}), catalog)
        result["detailed_bundle"] = detailed
        if total_calc > 0:
            result["total_price"] = total_calc

    cache_response(cache_key, result)

    elapsed = round(time.time() - start_time, 2)
    logger.info(f"Recommendation finished in {elapsed}s. Primary valuation: ${result.get('total_price')}")

    return jsonify(result)


# --- IN-STUDIO CONVERSATIONAL COPILOT REVISION ENDPOINT ---
@app.route("/refine", methods=["POST", "OPTIONS"])
@app.route("/api/refine", methods=["POST", "OPTIONS"])
@limiter.limit("5 per minute")  # Rate limit AI refinement requests
def refine_design():
    """Takes active bundle + revision directive, uses pruned context & fast model, returns adapted custom tier."""
    if request.method == "OPTIONS":
        return jsonify({"status": "preflight ok"}), 200

    start_time = time.time()
    data = request.get_json() or {}

    current_bundle = data.get("current_bundle", {})
    directive = data.get("directive", "").strip()
    style = data.get("style", "Minimalist Modern")
    budget = float(data.get("budget", 12000))
    width_ft = float(data.get("width", 16))
    depth_ft = float(data.get("depth", 14))

    if not directive:
        return jsonify({"error": "No architectural revision directive provided."}), 400

    logger.info(f"Copilot refinement directive received: '{directive}'")

    raw_catalog = load_raw_catalog()
    directive_cache_key = make_cache_key("refine", [width_ft, depth_ft, budget, style, directive, current_bundle], raw_catalog)
    cached_refine = get_cached_response(directive_cache_key)
    if cached_refine is not None:
        return jsonify(cached_refine)
    directive_lower = directive.lower()

    is_lowest = any(k in directive_lower for k in ["lowest", "cheapest", "minimum", "budget", "economy", "affordable"])
    is_highest = any(k in directive_lower for k in ["highest", "maximum", "luxury", "expensive", "premium", "most expensive"])

    effective_budget = budget * 3.5 if is_highest else budget
    filtered_candidates = constraint_filter(width_ft, depth_ft, effective_budget, style)

    for cat in filtered_candidates:
        if is_lowest:
            filtered_candidates[cat].sort(key=lambda x: x.get("price", 0))
        elif is_highest:
            filtered_candidates[cat].sort(key=lambda x: x.get("price", 0), reverse=True)

    catalog_summary = prune_catalog_context(filtered_candidates)

    refinement_prompt = f"""
ROLE: Kohler Spatial Architect.
CONTEXT: Room {width_ft}x{depth_ft}ft | Style: {style} | Directive: "{directive}"

PREVIOUS BUNDLE:
{json.dumps(current_bundle)}

PRUNED CATALOG OPTIONS:
{json.dumps(catalog_summary)}

RULES:
1. Prioritize user directive strictly over style defaults.
2. Select exactly ONE valid 'id' per category from the pruned catalog.
3. Return ONLY raw JSON matching this schema:
{{
  "title": "Copilot Custom Suite",
  "bundle": {{
    "faucet": "<valid_id>",
    "toilet": "<valid_id>",
    "shower": "<valid_id>",
    "vanity": "<valid_id>",
    "bathtub": "<valid_id>"
  }},
  "explanation": "<detailed architectural reasoning for the change>"
}}
"""

    try:
        custom_tier = generate_json(refinement_prompt + '\nKeep the explanation under 60 words.')
        for singular in ("faucet", "toilet", "shower", "vanity", "bathtub"):
            if custom_tier.get("bundle", {}).get(singular) not in {item['id'] for item in filtered_candidates.get(singular + 's', [])}:
                raise ValueError("Revision returned an unavailable product")

        detailed, total_calc = hydrate_bundle_items(custom_tier.get("bundle", {}), raw_catalog)
        custom_tier["detailed_bundle"] = detailed
        custom_tier["total_price"] = total_calc

        cache_response(directive_cache_key, custom_tier)

        elapsed = round(time.time() - start_time, 2)
        logger.info(f"Copilot refinement completed via Gemini in {elapsed}s: ${custom_tier['total_price']}")
        return jsonify(custom_tier)

    except Exception as e:
        logger.warning("AI refinement unavailable (%s); using local selection.", type(e).__name__)

        fallback_bundle = {}
        for cat in ["faucet", "toilet", "shower", "vanity", "bathtub"]:
            cat_key = f"{cat}s"
            candidates = filtered_candidates.get(cat_key, [])
            if candidates:
                fallback_bundle[cat] = candidates[0].get("id")
            else:
                fallback_bundle[cat] = current_bundle.get(cat, "")

        detailed, total_calc = hydrate_bundle_items(fallback_bundle, raw_catalog)
        fallback_tier = {
            "title": "Copilot Custom Suite",
            "bundle": fallback_bundle,
            "detailed_bundle": detailed,
            "total_price": total_calc,
            "explanation": f"Adaptive specification synthesized for directive: \"{directive}\"."
        }
        cache_response(directive_cache_key, fallback_tier)
        return jsonify(fallback_tier)


if __name__ == "__main__":
    app.run(debug=True, port=5000)
