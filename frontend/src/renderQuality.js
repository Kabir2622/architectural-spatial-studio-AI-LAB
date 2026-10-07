// Lock visible resolution; never lower it in response to FPS.
// Expanded rendering fits a 1920 x 1080 buffer, preserving viewport proportions.
export function studioPixelRatio(width, height, deviceRatio = 1, expanded = false) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const native = Math.max(1, Number(deviceRatio) || 1);
  return expanded ? Math.max(1, Math.min(1920 / w, 1080 / h)) : Math.min(native, 2);
}

// Bound only the auxiliary refraction pass, not the visible scene buffer.
export function glassRenderScale(width, height, dpr, walkthrough) {
  return Math.min(walkthrough ? 0.5 : 1, 640 / Math.max(1, width * dpr, height * dpr));
}
