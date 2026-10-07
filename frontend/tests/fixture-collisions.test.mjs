import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { doorFootprint, footprintsOverlap, overlappingFixtures } from '../src/fixtureCollisions.js';

const fixture = (id, x, z, width = 4, depth = 2, rotation = 0) => ({
  id, position: { x, z }, dimensions: { width, depth }, rotation
});

test('overlap flags both products, allows touching, and uses rotated catalog dimensions', () => {
  const a = fixture('vanity', 0, 0);
  const b = fixture('tub', 3.9, 0);
  assert.deepEqual(overlappingFixtures([a, b]), {vanity: true, tub: true});
  b.position.x = 4;
  assert.equal(footprintsOverlap(a, b), false);
  b.position.x = 3.1;
  b.rotation = 90;
  assert.equal(footprintsOverlap(a, b), false);
  b.position.x = 2.9;
  assert.equal(footprintsOverlap(a, b), true);
  assert.equal(footprintsOverlap(fixture('a', 0, 0, 6, 1, 45), fixture('b', 0, 2, 6, 1, 45)), false,
    'Separated angled fixtures must not trigger an axis-aligned false positive');
});

test('live dragging updates warnings only when overlap begins or ends', () => {
  const source = readFileSync(new URL('../src/FixtureCollision.jsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function FixtureCollisionMonitor('), source.indexOf('export function FixtureCollisionHighlight'));
  let frame;
  const monitor = vm.runInNewContext(code + '\nFixtureCollisionMonitor', {
    useRef: value => ({current: value}), useFrame: fn => {frame = fn;}, overlappingFixtures
  });
  const a = fixture('vanity', 0, 0), b = fixture('tub', 8, 0);
  const fixtures = {current: new Map([a, b].map(value => [value.id, {
    object: {position: value.position}, dimensions: value.dimensions, rotation: value.rotation
  }]))};
  const changes = [];
  monitor({fixtures, onChange: value => changes.push(value)});
  frame();
  for (let i = 0; i < 60; i++) frame();
  assert.equal(changes.length, 1);
  b.position.x = 1;
  frame();
  for (let i = 0; i < 60; i++) {b.position.x = 1 + i / 100; frame();}
  assert.equal(changes.length, 2, 'Continuous dragging inside overlap must not re-render React');
  assert.equal(changes[1].vanity, true);
  assert.equal(changes[1].tub, true);
  b.position.x = 8;
  frame();
  assert.equal(changes.length, 3);
  assert.equal(changes[2].vanity, false);
});

test('door collision follows the real hinge angle, including partial opening and closing', () => {
  const hinge = {x: -7.96, z: 4.9};
  const toilet = fixture('toilet', -5, 3.8, 1.5, 2.4);
  const closed = {id: 'door', ...doorFootprint(hinge, 90, 2.8, 0.34)};
  const open = {id: 'door', ...doorFootprint(hinge, 0, 2.8, 0.34)};
  assert.deepEqual(overlappingFixtures([closed, toilet]), {door: false, toilet: false});
  assert.deepEqual(overlappingFixtures([open, toilet]), {door: true, toilet: true});
  const partial = {id: 'door', ...doorFootprint(hinge, 45, 2.8, 0.34)};
  const product = fixture('vanity', partial.position.x, partial.position.z, 0.4, 0.4);
  assert.equal(footprintsOverlap(closed, product), false);
  assert.equal(footprintsOverlap(open, product), false);
  assert.equal(footprintsOverlap(partial, product), true);
  toilet.position.x = 0;
  assert.deepEqual(overlappingFixtures([open, toilet]), {door: false, toilet: false});
});

test('live monitor reads the animated door pose without committing frame positions to React', () => {
  const source = readFileSync(new URL('../src/FixtureCollision.jsx', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('function FixtureCollisionMonitor('), source.indexOf('export function FixtureCollisionHighlight'));
  let frame, angle = 90;
  const monitor = vm.runInNewContext(code + '\nFixtureCollisionMonitor', {
    useRef: value => ({current: value}), useFrame: fn => {frame = fn;}, overlappingFixtures
  });
  const toilet = fixture('toilet', -5, 3.8, 1.5, 2.4);
  const fixtures = {current: new Map([
    ['door', {getFootprint: () => doorFootprint({x: -7.96, z: 4.9}, angle, 2.8, 0.34)}],
    ['toilet', {object: {position: toilet.position}, dimensions: toilet.dimensions, rotation: 0}]
  ])};
  const changes = [];
  monitor({fixtures, onChange: flags => changes.push(flags)});
  frame(); angle = 0; frame();
  for (let i = 0; i < 60; i++) frame();
  assert.equal(changes.length, 2);
  assert.equal(changes[1].door, true);
  assert.equal(changes[1].toilet, true);
  angle = 90; frame();
  assert.equal(changes.length, 3);
  assert.equal(changes[2].door, false);
  assert.equal(changes[2].toilet, false);
});
