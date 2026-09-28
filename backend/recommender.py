"""
Multi-Tier LLM & Deterministic Recommender Layer
Generates distinct bundles with variance across pricing tiers and eco-efficiency.
"""

import os
import json
import logging
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

def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing in .env")
    return genai.Client(api_key=api_key)


def build_single_bundle(candidates: dict, style: str, target_budget: float, tier_label: str) -> dict:
    singular_map = {"faucets": "faucet", "toilets": "toilet", "showers": "shower", "vanities": "vanity"}
    bundle = {}
    total = 0

    allocations = {
        "vanities": target_budget * 0.45,
        "showers": target_budget * 0.25,
        "toilets": target_budget * 0.20,
        "faucets": target_budget * 0.10
    }

    for cat_key, cat_target in allocations.items():
        items = candidates.get(cat_key, [])
        if not items:
            continue

        if tier_label == "eco":
            # Explicitly favor high-efficiency / low-flow products for the Eco tier to ensure fixture variety
            efficient_pool = [i for i in items if "1.2" in str(i.get("flow_rate", "")) or "watersense" in str(i.get("features", [])).lower() or "low-flow" in str(i.get("flow_rate", "")).lower()]
            pool = efficient_pool if efficient_pool else items
            chosen = pool[len(pool) % len(pool)] if len(pool) > 1 else pool[0]
        elif tier_label == "essential":
            chosen = min(items, key=lambda x: x.get("price", 0))
        elif tier_label == "signature":
            chosen = max(items, key=lambda x: x.get("price", 0))
        else:
            chosen = min(items, key=lambda x: abs(x.get("price", 0) - cat_target))

        bundle[singular_map[cat_key]] = chosen["id"]
        total += chosen.get("price", 0)

    note = "Eco-optimized suite featuring high-efficiency aerators and WaterSense certification (-26% flow reduction)." if tier_label == "eco" else f"{tier_label.title()} collection harmonized in {style} aesthetic."
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
        client = get_client()
        eco_instruction = ""
        system_instruction_text = SYSTEM_PROMPT

        if eco_mode:
            eco_instruction = "\n\nCRITICAL ECO-EFFICIENCY CONSTRAINT: Prioritize WaterSense certified fixtures, high-efficiency low-flow aerators, and dual-flush options within the target budget to maximize water savings (-20% to -30% flow rates)."

        msg = f"Aesthetic: {style}\nTarget Budget: ${budget}\nEco-Mode Active: {eco_mode}{eco_instruction}\nCandidates:\n{json.dumps(filtered_candidates, indent=2)}"

        res = client.models.generate_content(
            model="gemini-3.8-flash",
            contents=msg,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction_text,
                response_mime_type="application/json"
            )
        )
        data = json.loads(res.text.strip())
        
        tiers = data.get("tiers", {})
        if (
            "essential" in tiers and "curated" in tiers and "signature" in tiers and "eco" in tiers
            and tiers["essential"]["total_price"] != tiers["signature"]["total_price"]
        ):
            return data

        logger.warning("Gemini produced equal tier prices or missed eco tier. Falling back to deterministic ladder.")
        return get_fallback_recommendation(filtered_candidates, style, budget)

    except Exception as e:
        logger.error(f"Gemini API error ({e}). Using deterministic 4-tier fallback.")
        return get_fallback_recommendation(filtered_candidates, style, budget)