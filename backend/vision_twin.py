"""
Photo-to-Twin Vision Layer
Estimates the real room envelope and fixture placements from a customer-uploaded
photo so the constraint engine and 3D studio reconstruct the customer's actual
space instead of a generic parametric box.
"""

import json
import logging
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

logger = logging.getLogger("kohler_backend")

env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

# Mirror the frontend slider ranges and drag padding so the twin can never
# produce a layout the 3D studio would reject or clamp into a corner.
ROOM_WIDTH_BOUNDS = (8.0, 28.0)
ROOM_DEPTH_BOUNDS = (8.0, 24.0)
WALL_PAD_FT = 1.8

FIXTURE_KEYS = ("vanity", "toilet", "shower", "bathtub")

STYLE_HINTS = [
    "Minimalist Modern",
    "Classic Luxury",
    "Japanese Zen",
    "Industrial Chic",
]

TWIN_PROMPT = f"""You are a spatial-reconstruction vision engine for a bathroom design studio.
Analyze the uploaded bathroom photo and estimate its REAL-WORLD dimensions and fixture layout.

Coordinate system for output (critical):
- The room is a rectangle. The origin (0, 0) is the CENTER of the floor.
- x axis runs left-to-right along the room's width, in feet.
- z axis runs back-to-front along the room's depth, in feet (negative z = far wall, positive z = near camera).
- rotation_deg is the fixture's facing direction, snapped to 0/90/180/270. 0 means facing the camera (+z).

Estimate dimensions using visual cues: door width (~2.7 ft), tile lines, bathtub length
(~5 ft standard), vanity height (~3 ft), ceiling height, and perspective.

Return ONLY raw JSON matching this exact schema:
{{
  "room": {{
    "width_ft": <number, {ROOM_WIDTH_BOUNDS[0]}-{ROOM_WIDTH_BOUNDS[1]}>,
    "depth_ft": <number, {ROOM_DEPTH_BOUNDS[0]}-{ROOM_DEPTH_BOUNDS[1]}>,
    "confidence": <number 0-1, how certain you are of the dimensions>
  }},
  "fixtures": {{
    "vanity": {{"x_ft": <number>, "z_ft": <number>, "rotation_deg": <0|90|180|270>, "confidence": <number 0-1>}},
    "toilet": {{"x_ft": <number>, "z_ft": <number>, "rotation_deg": <0|90|180|270>, "confidence": <number 0-1>}},
    "shower": {{"x_ft": <number>, "z_ft": <number>, "rotation_deg": <0|90|180|270>, "confidence": <number 0-1>}},
    "bathtub": {{"x_ft": <number>, "z_ft": <number>, "rotation_deg": <0|90|180|270>, "confidence": <number 0-1>}}
  }},
  "style_hint": "<one of: {", ".join(STYLE_HINTS)}>",
  "notes": "<one sentence describing the reconstructed room>"
}}

RULES:
- Every fixture position must sit inside the room: |x_ft| <= width_ft/2 - 1.8 and |z_ft| <= depth_ft/2 - 1.8.
- Fixtures should not overlap: keep centers at least 3.6 ft apart.
- If a fixture is not visible in the photo, infer its most probable position from typical bathroom layouts
  (vanity near the door on one wall, toilet beside the vanity, shower/tub on the far wall).
- Use plausible round-ish estimates; this is an approximation pass, not a survey.
"""


def _clamp(value, lo, hi):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return lo
    return max(lo, min(hi, v))


def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing in .env")
    return genai.Client(api_key=api_key)


def _default_positions():
    return {
        "vanity": (-4.8, -4.2),
        "shower": (4.8, -4.2),
        "toilet": (-5.0, 3.8),
        "bathtub": (3.8, 3.5),
    }


def _normalize(data: dict) -> dict:
    room = data.get("room") or {}
    width_ft = _clamp(room.get("width_ft"), *ROOM_WIDTH_BOUNDS)
    depth_ft = _clamp(room.get("depth_ft"), *ROOM_DEPTH_BOUNDS)

    max_x = max(WALL_PAD_FT, width_ft / 2 - WALL_PAD_FT)
    max_z = max(WALL_PAD_FT, depth_ft / 2 - WALL_PAD_FT)
    defaults = _default_positions()

    fixtures_out = {}
    raw_fixtures = data.get("fixtures") or {}
    for key in FIXTURE_KEYS:
        entry = raw_fixtures.get(key) or {}
        default_x, default_z = defaults[key]
        rot = entry.get("rotation_deg", 0)
        try:
            rot = int(float(rot)) % 360
        except (TypeError, ValueError):
            rot = 0
        fixtures_out[key] = {
            "x_ft": round(_clamp(entry.get("x_ft", default_x), -max_x, max_x), 2),
            "z_ft": round(_clamp(entry.get("z_ft", default_z), -max_z, max_z), 2),
            "rotation_deg": int(round(rot / 90.0) * 90) % 360,
            "confidence": round(_clamp(entry.get("confidence"), 0, 1), 2),
        }

    style_hint = data.get("style_hint")
    if style_hint not in STYLE_HINTS:
        style_hint = None

    return {
        "room": {
            "width_ft": round(width_ft, 1),
            "depth_ft": round(depth_ft, 1),
            "confidence": round(_clamp(room.get("confidence"), 0, 1), 2),
        },
        "fixtures": fixtures_out,
        "style_hint": style_hint,
        "notes": str(data.get("notes", "")).strip()[:300],
    }


def analyze_bathroom_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    client = get_client()

    contents = [
        types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
        TWIN_PROMPT,
    ]
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )

    # Free-tier vision calls return transient 503 "high demand" frequently; spread
    # retries over ~75s so a demand spike can pass instead of failing the upload.
    last_error = None
    for attempt, delay in enumerate((0, 5, 10, 15, 20, 25)):
        if delay:
            time.sleep(delay)
        try:
            res = client.models.generate_content(
                model="gemini-3.8-flash",
                contents=contents,
                config=config,
            )
            break
        except Exception as e:
            last_error = e
            message = str(e)
            # 429 is the daily quota wall; sleeping and retrying cannot clear it.
            if "429" in message or "RESOURCE_EXHAUSTED" in message:
                raise
            if "503" not in message and "UNAVAILABLE" not in message:
                raise
            logger.warning(f"Vision model unavailable (attempt {attempt + 1}/6): {message[:120]}")
    else:
        raise last_error

    try:
        data = json.loads(res.text.strip())
    except json.JSONDecodeError as e:
        logger.error(f"Vision model returned non-JSON payload: {res.text[:200]}")
        raise ValueError("Vision model returned malformed JSON.") from e

    normalized = _normalize(data)
    logger.info(
        f"Photo-to-twin reconstruction: {normalized['room']['width_ft']}x"
        f"{normalized['room']['depth_ft']}ft, style_hint={normalized['style_hint']}"
    )
    return normalized
