import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSavedLayout, savedPreset } from '../src/restoreLayout.js';

const saved = () => ({ version: 1, id: 'layout-a', name: 'My bathroom', savedAt: '2026-10-06T12:00:00Z',
  width: 18, depth: 16, price: 3456, finish: 'Polished Chrome', wall: 'Cashmere Beige', lighting: 'spaNight',
  positions: {bathtub: [4, 0, 3], vanity: [-5, 0, -5], toilet: [-5, 0, 3], shower: [5, 0, -5]},
  rotations: {bathtub: 90, vanity: 0, toilet: 180, shower: 270},
  dimensions: {bathtub: {width: 6, depth: 3}, vanity: {width: 4, depth: 2}, toilet: {width: 2, depth: 3}, shower: {width: 4, depth: 4}},
  products: {bathtub: {id: 'K-tub', name: 'Soaking tub'}, faucet: {id: 'K-faucet', flow_rate: '1.2 GPM'},
    shower: {id: 'K-shower', footprint_in: {width: 6, depth: 6}, flow_rate: '1.75 GPM'}} });

test('loading preserves saved products, rates, price, room and transforms independently of current catalog', () => {
  const original = saved();
  const {snapshot, tier} = prepareSavedLayout(original);
  assert.equal(tier.bundle.bathtub, 'K-tub');
  assert.equal(tier.detailed_bundle.faucet.flow_rate, '1.2 GPM');
  assert.equal(tier.total_price, 3456);
  assert.equal(snapshot.width, 18);
  assert.equal(snapshot.rotations.toilet, 180);
  assert.deepEqual(tier.detailed_bundle.bathtub.footprint_in, {width: 72, depth: 36});
  assert.deepEqual(tier.detailed_bundle.shower.footprint_in, {width: 6, depth: 6}, 'Preserve shower-head geometry separately from enclosure');
  snapshot.positions.bathtub[0] = 10;
  tier.detailed_bundle.faucet.flow_rate = '9 GPM';
  assert.equal(original.positions.bathtub[0], 4);
  assert.equal(original.products.faucet.flow_rate, '1.2 GPM');
  assert.notEqual(prepareSavedLayout(original).snapshot, snapshot, 'Loading the same layout again must produce a fresh restore request');
});

test('legacy labels restore presets, keys remain supported, and invalid layouts are rejected', () => {
  const presets = {brass: {label: 'Moderne Brass'}, chrome: {label: 'Polished Chrome'}};
  assert.equal(savedPreset('Polished Chrome', presets, 'brass'), 'chrome');
  assert.equal(savedPreset('chrome', presets, 'brass'), 'chrome');
  assert.equal(savedPreset('Unknown', presets, 'brass'), 'brass');
  assert.throws(() => prepareSavedLayout({}), /cannot be restored/);
  const invalid = saved(); invalid.positions.vanity[0] = Infinity;
  assert.throws(() => prepareSavedLayout(invalid), /cannot be restored/);
});
