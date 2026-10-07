import test from 'node:test';
import assert from 'node:assert/strict';
import { studioPixelRatio, glassRenderScale } from '../src/renderQuality.js';

test('expanded rendering fits full HD without downscaling the display or distorting proportions', () => {
  for (const [w, h] of [[1212, 572], [1440, 994], [1920, 1080]]) {
    const dpr = studioPixelRatio(w, h, 1, true);
    assert.ok(dpr >= 1);
    assert.ok(Math.abs(w * dpr - 1920) < 0.001 || Math.abs(h * dpr - 1080) < 0.001);
    assert.ok(Math.abs((w * dpr) / (h * dpr) - w / h) < 0.000001);
  }
  assert.equal(studioPixelRatio(3840, 2160, 1, true), 1);
});

test('preview stays sharp and resolution does not degrade over time', () => {
  assert.equal(studioPixelRatio(560, 360, 1, false), 1);
  assert.equal(studioPixelRatio(560, 360, 2, false), 2);
  assert.equal(studioPixelRatio(560, 360, 3, false), 2);
  const initial = studioPixelRatio(1440, 994, 1, true);
  for (let i = 0; i < 600; i++) assert.equal(studioPixelRatio(1440, 994, 1, true), initial);
});

test('only auxiliary glass rendering is bounded and walkthrough settings stay intact', () => {
  assert.equal(glassRenderScale(560, 360, 1, false), 1);
  assert.equal(glassRenderScale(560, 360, 1, true), 0.5);
  assert.equal(1920 * glassRenderScale(1920, 1080, 1, false), 640);
});
