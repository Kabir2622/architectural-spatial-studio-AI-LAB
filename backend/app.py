import json
import logging
import os
import sys
import time
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

from recommender import get_llm_recommendation

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

# Initialize Redis Client for Token Caching
try:
    redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
    redis_client.ping()
    logger.info("Successfully connected to Redis cache.")
except Exception as e:
    logger.warning(f"Redis connection failed. Running without cache: {e}")
    redis_client = None


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
                with p.open(encoding="utf-8") as f:
                    data = json.load(f)
                    logger.info(f"Loaded catalog successfully from: {p}")
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
        cat_key = f"{category_singular}s" if not category_singular.endswith("s") else category_singular
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

    width_ft = float(data.get("width_ft", data.get("width", 8)))
    depth_ft = float(data.get("depth_ft", data.get("depth", 6)))
    budget = float(data.get("budget", 3000))
    style = data.get("style", "Minimalist Modern")
    eco_mode = bool(data.get("eco_mode", False))

    logger.info(f"Incoming baseline recommendation request: {width_ft}x{depth_ft}ft, Budget: ${budget}, Style: '{style}', EcoMode: {eco_mode}")

    cache_key = f"rec:{width_ft}:{depth_ft}:{budget}:{style.lower()}:eco_{eco_mode}"
    if redis_client:
        try:
            cached_res = redis_client.get(cache_key)
            if cached_res:
                logger.info("Cache hit! Serving recommendation instantly from Redis (0 tokens used).")
                return jsonify(json.loads(cached_res))
        except Exception as ce:
            logger.warning(f"Redis get error: {ce}")

    candidate_budget_ceiling = budget * 1.5
    filtered_candidates = constraint_filter(width_ft, depth_ft, candidate_budget_ceiling, style)

    logger.info("Dispatching filtered candidates to recommendation engine...")
    result = get_llm_recommendation(filtered_candidates, style, budget, eco_mode=eco_mode)

    if "error" in result:
        elapsed = round(time.time() - start_time, 2)
        logger.error(f"Recommendation failed after {elapsed}s: {result['error']}")
        return jsonify(result), 400

    catalog = load_raw_catalog()

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

    if redis_client:
        try:
            redis_client.setex(cache_key, 86400, json.dumps(result))
        except Exception as se:
            logger.warning(f"Redis set error: {se}")

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

    directive_cache_key = f"refine:{width_ft}:{depth_ft}:{budget}:{style.lower()}:{directive.lower()}"
    if redis_client:
        try:
            cached_refine = redis_client.get(directive_cache_key)
            if cached_refine:
                logger.info("Cache hit! Serving refinement instantly from Redis (0 tokens used).")
                return jsonify(json.loads(cached_refine))
        except Exception as ce:
            logger.warning(f"Redis refinement get error: {ce}")

    raw_catalog = load_raw_catalog()
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
        import google.generativeai as genai
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY not configured.")
        genai.configure(api_key=api_key)
        
        model = genai.GenerativeModel("gemini-3.8-flash")
        response = model.generate_content(
            refinement_prompt,
            generation_config={"response_mime_type": "application/json"}
        )
        custom_tier = json.loads(response.text)

        detailed, total_calc = hydrate_bundle_items(custom_tier.get("bundle", {}), raw_catalog)
        custom_tier["detailed_bundle"] = detailed
        custom_tier["total_price"] = total_calc

        if redis_client:
            try:
                redis_client.setex(directive_cache_key, 86400, json.dumps(custom_tier))
            except Exception as se:
                logger.warning(f"Redis refinement set error: {se}")

        elapsed = round(time.time() - start_time, 2)
        logger.info(f"Copilot refinement completed via Gemini in {elapsed}s: ${custom_tier['total_price']}")
        return jsonify(custom_tier)

    except Exception as e:
        logger.error(f"Gemini refinement failed or threw exception: {e}. Executing algorithmic directive fallback.")

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
        return jsonify(fallback_tier)


if __name__ == "__main__":
    app.run(debug=True, port=5000)