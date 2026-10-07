import { FIXTURE_LABELS, isValidSnapshot } from './layoutComparison.js';

export function savedPreset(value, presets, fallback) {
  return Object.keys(presets).find(key => key === value || presets[key].label === value) || fallback;
}

export function prepareSavedLayout(value) {
  if (!isValidSnapshot(value)) throw new Error('This saved layout cannot be restored.');
  const snapshot = JSON.parse(JSON.stringify(value));
  const detailed = {};
  for (const id of [...Object.keys(FIXTURE_LABELS), 'faucet']) {
    const product = snapshot.products[id];
    const dimensions = snapshot.dimensions[id];
    if (!product && !dimensions) continue;
    detailed[id] = { ...product };
    // Older snapshots may lack product footprints. Retain the geometry that
    // was actually saved without inventing a product model or flow rating.
    if (!detailed[id].footprint_in && dimensions) {
      detailed[id].footprint_in = { width: dimensions.width * 12, depth: dimensions.depth * 12 };
    }
  }
  return { snapshot, tier: {
    title: `Saved layout: ${snapshot.name}`,
    total_price: Number.isFinite(snapshot.price) ? snapshot.price : null,
    explanation: 'Restored from your saved layout. You can continue editing this arrangement.',
    bundle: Object.fromEntries(Object.entries(detailed).filter(([, product]) => typeof product.id === 'string' && product.id).map(([id, product]) => [id, product.id])),
    detailed_bundle: detailed
  } };
}
