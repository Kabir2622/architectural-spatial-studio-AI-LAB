import test from 'node:test';
import assert from 'node:assert/strict';
import { assessClearances, estimateResources, parseWaterRate, resolveResourceProducts } from '../src/layoutComparison.js';

const scene = () => ({ width: 16, depth: 14,
  positions: { vanity: [-4, 0, -4], toilet: [4, 0, -4] },
  dimensions: { vanity: { width: 3, depth: 2 }, toilet: { width: 2, depth: 2 } },
  rotations: { vanity: 0, toilet: 0 } });

test('moving a fixture changes front clearance and detects footprint overlap', () => {
  const layout = scene();
  assert.equal(assessClearances(layout).front.find(item => item.id === 'vanity').inches, 120);
  layout.positions.toilet = [-4, 0, 0];
  assert.equal(assessClearances(layout).front.find(item => item.id === 'vanity').inches, 24);
  layout.positions.toilet = [-4, 0, -3];
  assert.equal(assessClearances(layout).collisions.length, 1);
  assert.equal(assessClearances(layout).front.find(item => item.id === 'vanity').inches, 0);
});

test('front measurements follow rotated fixtures', () => {
  const layout = scene();
  layout.rotations.vanity = 90;
  layout.positions.toilet = [0, 0, -4];
  assert.ok(Math.abs(assessClearances(layout).front.find(item => item.id === 'vanity').inches - 24) < 1e-6);
});

test('estimates use rated units and explicit dual-flush mix, with missing data unavailable', () => {
  assert.equal(parseWaterRate('1.28 GPF', 'GPM'), null);
  assert.equal(parseWaterRate('WaterSense certified', 'GPM'), null);
  assert.ok(Math.abs(parseWaterRate('0.8 / 1.6 GPF', 'GPF') - 1.0666666667) < 1e-6);
  assert.equal(estimateResources({}).annualGallons, null);
  const products = { shower: { flow_rate: '1.75 GPM' }, toilet: { flow_rate: '1.28 GPF' }, faucet: { flow_rate: '1.2 GPM' } };
  const result = estimateResources(products);
  assert.equal(result.annualGallons, 18396);
  assert.equal(result.gallonsSaved, 8468);
  assert.ok(result.energySaved > 0);
});

test('old saved layouts recover missing ratings by exact model without overwriting saved ratings', () => {
  const products = { shower: { id: 'K-shower', flow_rate: 'WaterSense Certified' },
    faucet: { id: 'K-faucet', flow_rate: '1.2 GPM' }, toilet: { id: 'unknown' } };
  const catalog = { showers: [{ id: 'K-shower', flow_rate: '1.75 GPM' }],
    faucets: [{ id: 'K-faucet', flow_rate: '2.2 GPM' }], toilets: [{ id: 'another', flow_rate: '1.28 GPF' }] };
  const recovered = resolveResourceProducts(products, catalog);
  assert.equal(recovered.shower.flow_rate, '1.75 GPM');
  assert.equal(recovered.faucet.flow_rate, '1.2 GPM');
  assert.equal(recovered.toilet.flow_rate, undefined);
  assert.equal(products.shower.flow_rate, 'WaterSense Certified');
  const estimate = estimateResources(recovered);
  assert.equal(estimate.complete, false);
  assert.equal(estimate.gallonsSaved, null);
  assert.equal(estimate.knownGallonsSaved, 7300);
  assert.ok(estimate.energySaved > 0); // Missing toilet rating doesn't block hot-water estimates.
  assert.deepEqual(estimate.missing, ['toilet']);
});

test('missing faucet still shows shower estimates as partial rather than invented totals', () => {
  const estimate = estimateResources({ shower: { flow_rate: '1.75 GPM' } });
  assert.equal(estimate.knownGallonsSaved, 4380);
  assert.equal(estimate.energySaved, null);
  assert.ok(estimate.knownEnergySaved > 0);
  assert.equal(estimateResources({}).knownEnergySaved, null);
});
