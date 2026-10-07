"""
Multi-Tier LLM & Deterministic Recommender Layer
Generates distinct bundles with variance across pricing tiers and eco-efficiency.
"""

import os
import json
import logging
import re
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import BoundedSemaphore
from pathlib import Path
from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger("kohler_backend")

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

SYSTEM_PROMPT = """You are a senior Kohler architectural design director.
Given candidate fixtures, room constraints, and target budget, you MUST generate four distinct design tiers with DIFFERENT products and valuations:

1. "essential": Economical, value-engineered products (~50-65% of budget).
2. "curated": Balanced mid-range fixtures (~85-100% of budget) matching the budget target.
3. "signature": Top-tier luxury or smart fixtures (~125-150% of budget).
4. "eco": Highly water-efficient, WaterSense certified fixtures optimized specifically for resource conservation while maintaining the style and featuring distinct lower-flow options.

MANDATORY RULES:
- The tiers MUST contain DIFFERENT products where possible.
- essential total_price < eco total_price < curated total_price < signature total_price. They MUST NEVER be equal.

Output strictly valid JSON matching this schema:
{
  "tiers": {
    "essential": {
      "title": "Essential Architectural Tier",
      "bundle": {"faucet": "<id>", "toilet": "<id>", "shower": "<id>", "vanity": "<id>"},
      "total_price": <number>,
      "explanation": "<rationale>"
    },
    "curated": {
      "title": "Curated Designer Tier",
      "bundle": {"faucet": "<id>", "toilet": "<id>", "shower": "<id>", "vanity": "<id>"},
      "total_price": <number>,
      "explanation": "<rationale>"
    },
    "signature": {
      "title": "Signature Luxury Tier",
      "bundle": {"faucet": "<id>", "toilet": "<id>", "shower": "<id>", "vanity": "<id>"},
      "total_price": <number>,
      "explanation": "<rationale>"
    },
    "eco": {
      "title": "Eco-Optimized Suite",
      "bundle": {"faucet": "<id>", "toilet": "<id>", "shower": "<id>", "vanity": "<id>"},
      "total_price": <number>,
      "explanation": "<rationale>"
    }
  }
}
"""

# Keep network retries/latency from blocking the studio indefinitely. The
# semaphore also prevents expired calls from piling up during an outage.
_generation_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="kohler-ai")
_generation_slots = BoundedSemaphore(2)
GENERATION_TIMEOUT = 8
DEFAULT_MODEL = "gemini-3.5-flash-lite"


def compact_candidates(candidates):
    return {category: [{key: item.get(key) for key in
            ("id", "name", "price", "style", "finish", "flow_rate")}
            for item in items] for category, items in candidates.items()}

@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing in .env")
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(
        # Gemini requires >=10s transport deadline. The request's separate
        # eight-second application deadline still returns a local bundle promptly.
        timeout=15000,
        retry_options=types.HttpRetryOptions(attempts=1)))


def generate_json(prompt, instruction=None):
    if not _generation_slots.acquire(blocking=False):
        raise TimeoutError("Recommendation service is busy; using local selection")

    def generate():
        try:
            model = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
            response = get_client().models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(system_instruction=instruction,
                    response_mime_type="application/json", max_output_tokens=2400,
                    automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
                    thinking_config=types.ThinkingConfig(thinking_level="low" if model.startswith(("gemini-3.7", "gemini-3.8")) else "minimal") if model.startswith("gemini-3") else None,
                    temperature=0.2))
            return json.loads(response.text)
        finally:
            _generation_slots.release()

    future = _generation_pool.submit(generate)
    return future.result(timeout=GENERATION_TIMEOUT)


def build_single_bundle(candidates: dict, style: str, target_budget: float, tier_label: str) -> dict:
    singular_map = {"faucets": "faucet", "toilets": "toilet", "showers": "shower", "vanities": "vanity", "bathtubs": "bathtub"}
    bundle = {}
    total = 0

    allocations = {
        "vanities": target_budget * 0.30,
        "showers": target_budget * 0.15,
        "toilets": target_budget * 0.15,
        "faucets": target_budget * 0.10,
        "bathtubs": target_budget * 0.30
    }

    for cat_key, cat_target in allocations.items():
        items = candidates.get(cat_key, [])
        if not items:
            continue

        if tier_label == "eco":
            # Explicitly favor high-efficiency / low-flow products for the Eco tier to ensure fixture variety
            def efficiency(item):
                rate = str(item.get("flow_rate", ""))
                numbers = re.findall(r"\d+(?:\.\d+)?", rate)
                # Avoid interpreting tub capacity or cabinetry as consumption.
                flow = sum(map(float, numbers)) / len(numbers) if numbers and re.search(r"GP[MF]", rate, re.I) else float("inf")
                return (flow, abs(item.get("price", 0) - cat_target))
            chosen = min(items, key=efficiency)
        elif tier_label == "essential":
            chosen = min(items, key=lambda x: x.get("price", 0))
        elif tier_label == "signature":
            chosen = max(items, key=lambda x: x.get("price", 0))
        else:
            chosen = min(items, key=lambda x: abs(x.get("price", 0) - cat_target))

        bundle[singular_map[cat_key]] = chosen["id"]
        total += chosen.get("price", 0)

    note = "Selected for lower published flow rates where available; compare product specifications for estimated savings." if tier_label == "eco" else f"{tier_label.title()} collection harmonized in {style} aesthetic."
    return {
        "bundle": bundle,
        "total_price": total,
        "explanation": note
    }


def get_fallback_recommendation(candidates: dict, style: str, budget: float = 3000) -> dict:
    logger.warning(f"Using deterministic 4-tier fallback engine for budget=${budget}, style='{style}'")
    return {
        "tiers": {
            "essential": {
                "title": "Essential Architectural Tier",
                **build_single_bundle(candidates, style, budget * 0.60, "essential")
            },
            "curated": {
                "title": "Curated Designer Tier",
                **build_single_bundle(candidates, style, budget * 1.00, "curated")
            },
            "eco": {
                "title": "Eco-Optimized Suite 🌱",
                **build_single_bundle(candidates, style, budget * 0.85, "eco")
            },
            "signature": {
                "title": "Signature Luxury Tier",
                **build_single_bundle(candidates, style, budget * 1.50, "signature")
            }
        }
    }


def get_llm_recommendation(filtered_candidates: dict, style: str, budget: float = 3000, eco_mode: bool = False) -> dict:
    empty = [c for c, items in filtered_candidates.items() if not items]
    if empty:
        return {"error": f"No products fit dimensions/budget in: {', '.join(empty)}"}

    try:
        eco_instruction = ""
        system_instruction_text = SYSTEM_PROMPT

        if eco_mode:
            eco_instruction = "\n\nCRITICAL ECO-EFFICIENCY CONSTRAINT: Prioritize WaterSense certified fixtures, high-efficiency low-flow aerators, and dual-flush options within the target budget to maximize water savings (-20% to -30% flow rates)."

        msg = f"Aesthetic: {style}\nTarget Budget: ${budget}\nEco-Mode Active: {eco_mode}{eco_instruction}\nCandidates:\n{json.dumps(compact_candidates(filtered_candidates), separators=(',', ':'))}"
        data = generate_json(msg, system_instruction_text +
            '\nInclude bathtub in each bundle when bathtubs are available. Use only supplied IDs. Keep each explanation under 45 words.')
        
        tiers = data.get("tiers", {})
        if (
            "essential" in tiers and "curated" in tiers and "signature" in tiers and "eco" in tiers
            and tiers["essential"]["total_price"] != tiers["signature"]["total_price"]
        ):
            categories = {"faucet": "faucets", "toilet": "toilets", "shower": "showers", "vanity": "vanities", "bathtub": "bathtubs"}
            for tier in tiers.values():
                bundle = tier.get("bundle", {})
                for singular, plural in categories.items():
                    available = filtered_candidates.get(plural, [])
                    if available and bundle.get(singular) not in {item["id"] for item in available}:
                        raise ValueError("Model returned an unavailable product")
            data["recommendation_source"] = "ai"
            return data

        logger.warning("Gemini produced equal tier prices or missed eco tier. Falling back to deterministic ladder.")
        return get_fallback_recommendation(filtered_candidates, style, budget)

    except Exception as e:
        logger.warning("AI recommendation unavailable (%s). Using local 4-tier selection.", type(e).__name__)
        result = get_fallback_recommendation(filtered_candidates, style, budget)
        result["recommendation_source"] = "local"
        return result
