import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// Execute the real control functions with a renderer-free R3F hook adapter.
// This checks their input/commit contracts without requiring a WebGL GPU in CI.
const source = readFileSync(new URL('../src/Bathroom3D.jsx', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
class EventSurface {
  attributes = new Map();
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  listeners = new Map(); captured = new Set(); pointerLockElement = null;
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  emit(type, props = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ type, preventDefault() {}, ...props }); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
}
function setup(name, endMarker, props) {
  const canvas = new EventSurface(), window = new EventSurface(), document = new EventSurface();
  canvas.ownerDocument = document;
  document.exitPointerLock = () => { document.pointerLockElement = null; };
  let compute = (event, state) => state.pointer.set(event.x, event.y);
  const camera = new THREE.PerspectiveCamera(40, 1000 / 700, 0.1, 100);
  camera.position.set(0, 4, 8); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const gl = { domElement: canvas, shadowMap: { autoUpdate: true, needsUpdate: false }, transmissionResolutionScale: 1 };
  const refs = [], frames = [], effects = [];
  let invalidations = 0;
  const controlsRef = { current: null }, commits = [];
  const context = { THREE, window, document, HTMLElement: class {},
    useMemo: fn => fn(), useCallback: fn => fn,
    useRef: value => { const ref = { current: value }; refs.push(ref); return ref; },
    useEffect: fn => effects.push(fn), useLayoutEffect: fn => effects.push(fn), useFrame: fn => frames.push(fn),
    useThree: () => ({ gl, camera, invalidate: () => invalidations++, get: () => ({ events: { compute } }), setEvents: value => { compute = value.compute; } }) };
  let text = source.slice(source.indexOf(`function ${name}(`), source.indexOf(endMarker, source.indexOf(`function ${name}(`)));
  if (name === 'DraggableFixture') {
    const down = text.slice(text.indexOf('onPointerDown={event => {') + 'onPointerDown={event => {'.length, text.indexOf('\n    }}>'));
    text = text.slice(0, text.indexOf('\n  return (\n')) + '\nreturn Object.assign(event => {' + down + '\n}, { pickFixture });\n}';
  }
  const helpers = source.slice(source.indexOf('const MODEL_DIMENSIONS'), source.indexOf('// Pointer movement writes'));
  const fn = vm.runInNewContext(helpers + text + `\n${name}`, context);
  const result = fn({ id: 'bathtub', position: [0, 0, 0], width: 16, depth: 14, enabled: true,
    onStart() {}, onCommit: (id, position) => commits.push({ id, position }), controlsRef, ...props });
  if (name === 'DraggableFixture') refs[0].current = new THREE.Group();
  const cleanups = effects.map(fn => fn()).filter(Boolean);
  return { canvas, window, document, camera, gl, refs, commits, effects, result,
    frame: (delta = 1 / 60, elapsedTime = 0) => frames.forEach(fn => fn({ clock: { elapsedTime } }, delta)),
    compute: (event, state) => compute(event, state), invalidations: () => invalidations, cleanup: () => cleanups.reverse().forEach(fn => fn()) };
}
function grab(context) {
  const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(new THREE.Vector2(), context.camera);
  context.result({ button: 0, pointerId: 1, ray: raycaster.ray, stopPropagation() {} });
}

test('pointer-lock grab follows walking and turning, commits once, and applies the last turn on release', () => {
  const c = setup('DraggableFixture', '// Scene Background', { walkthrough: true });
  c.document.pointerLockElement = c.canvas;
  grab(c);
  assert.equal(c.canvas.captured.size, 0, 'Native pointer capture is unnecessary under pointer lock');
  c.frame();
  assert.ok(c.refs[0].current.position.length() < 1e-8, 'Grab does not jump');
  c.camera.position.x = 1;
  for (let i = 0; i < 120; i++) c.frame();
  assert.ok(c.refs[0].current.position.x > 0.9);
  assert.equal(c.commits.length, 0, 'No React position commit while carrying');
  c.camera.lookAt(3, 0, 0);
  c.window.emit('pointerup', { pointerId: 1 });
  const saved = c.refs[0].current.position.clone();
  assert.ok(saved.x > 2, 'Release includes a camera turn before the next frame');
  c.window.emit('pointerup', { pointerId: 1 });
  assert.equal(c.commits.length, 1);
  assert.deepEqual(Array.from(c.commits[0].position), saved.toArray());
  c.cleanup();
});

test('losing pointer lock cancels the grab and stops scheduling frames', () => {
  const c = setup('DraggableFixture', '// Scene Background', { walkthrough: true });
  c.document.pointerLockElement = c.canvas; grab(c);
  c.camera.position.x = 2; c.frame();
  c.document.pointerLockElement = null; c.document.emit('pointerlockchange');
  assert.ok(c.refs[0].current.position.length() < 1e-8);
  const count = c.invalidations(); c.frame();
  assert.equal(c.invalidations(), count);
  assert.equal(c.commits.length, 1);
  c.cleanup();
});

test('unlocked VR still supports normal cursor dragging', () => {
  const c = setup('DraggableFixture', '// Scene Background', { walkthrough: true });
  grab(c);
  c.canvas.emit('pointermove', { pointerId: 1, clientX: 600, clientY: 400 }); c.frame();
  assert.ok(c.refs[0].current.position.length() > 0.1);
  assert.equal(c.commits.length, 0);
  c.window.emit('pointerup', { pointerId: 1, clientX: 600, clientY: 400 });
  assert.equal(c.commits.length, 1);
  c.cleanup();
});

test('mouse look supports right-drag fallback and centers picking only when pointer lock is active', () => {
  const c = setup('WalkthroughMouseLook', '// Camera movement', {});
  const initial = c.camera.quaternion.clone();
  c.document.emit('mousemove', { clientX: 550, clientY: 350 });
  assert.ok(c.camera.quaternion.angleTo(initial) < 1e-7);
  c.canvas.emit('pointerdown', { button: 2, clientX: 500, clientY: 350 });
  c.document.emit('mousemove', { clientX: 600, clientY: 380 });
  assert.ok(c.camera.quaternion.angleTo(initial) > 0.1);
  c.window.emit('pointerup', { button: 2 });
  const stopped = c.camera.quaternion.clone();
  c.document.emit('mousemove', { clientX: 650, clientY: 400 });
  assert.ok(c.camera.quaternion.angleTo(stopped) < 1e-7);
  const state = { pointer: new THREE.Vector2(), raycaster: new THREE.Raycaster(), camera: c.camera };
  c.compute({ x: 0.4, y: 0.7 }, state);
  assert.deepEqual(state.pointer.toArray(), [0.4, 0.7]);
  c.document.pointerLockElement = c.canvas;
  c.compute({ x: 0.4, y: 0.7 }, state);
  assert.deepEqual(state.pointer.toArray(), [0, 0]);
  c.document.emit('mousemove', { movementX: 30, movementY: 10, clientX: 650, clientY: 400 });
  assert.ok(c.camera.quaternion.angleTo(stopped) > 0.01);
  c.cleanup();
  assert.equal(c.document.pointerLockElement, null);
  c.compute({ x: 0.2, y: 0.8 }, state);
  assert.deepEqual(state.pointer.toArray(), [0.2, 0.8]);
});

test('walkthrough is idle on demand, starts on WASD, clears keys on blur, and caps resumed frame delta', () => {
  const c = setup('VRWalkthroughController', 'function WalkthroughMouseLook', { enabled: true });
  const count = c.invalidations(); c.frame();
  assert.equal(c.invalidations(), count);
  const before = c.camera.position.clone();
  c.window.emit('keydown', { code: 'KeyW' }); c.frame(10);
  assert.ok(c.camera.position.distanceTo(before) <= 0.351, 'No large jump after idle');
  assert.ok(c.invalidations() > count);
  c.window.emit('blur');
  const stopped = c.camera.position.clone(), stoppedCount = c.invalidations(); c.frame();
  assert.equal(c.camera.position.distanceTo(stopped), 0);
  assert.equal(c.invalidations(), stoppedCount);
  c.window.emit('keydown', { code: 'KeyW' });
  c.window.emit('keydown', { code: 'KeyS' }); c.frame();
  const oppositeCount = c.invalidations();
  c.window.emit('keyup', { code: 'KeyS' });
  assert.ok(c.invalidations() > oppositeCount, 'Releasing an opposing key wakes the demand loop');
  c.frame();
  assert.ok(c.camera.position.distanceTo(stopped) > 0);
  c.cleanup();
});

test('VR caches static shadows, throttles moving shadows, and restores renderer settings', () => {
  const c = setup('RenderBudget', '// Cinematic Automated', { walkthrough: true, dragging: false, revision: 'room' });
  assert.equal(c.gl.shadowMap.autoUpdate, false);
  assert.equal(c.gl.transmissionResolutionScale, 0.5);
  c.frame(); c.frame(); // Finish the initial room shadow bake after environment capture.
  c.gl.shadowMap.needsUpdate = false;
  for (let i = 0; i < 120; i++) c.frame(1 / 60, i / 60);
  assert.equal(c.gl.shadowMap.needsUpdate, false, 'Camera-only frames do not rebake shadows');
  c.cleanup();
  assert.equal(c.gl.shadowMap.autoUpdate, true);
  assert.equal(c.gl.transmissionResolutionScale, 1);

  const moving = setup('RenderBudget', '// Cinematic Automated', { walkthrough: true, dragging: true, revision: 'room' });
  let updates = 0;
  for (let i = 0; i < 120; i++) {
    moving.gl.shadowMap.needsUpdate = false; moving.frame(1 / 60, i / 60);
    if (moving.gl.shadowMap.needsUpdate) updates++;
  }
  assert.ok(updates > 20 && updates <= 42, 'At most 20 shadow updates per second');
  moving.cleanup();
});

const dimensionsHelpers = vm.runInNewContext(
  source.slice(source.indexOf('const MODEL_DIMENSIONS'), source.indexOf('// Pointer movement writes'))
    + '\n({ resolveProductDimensions, rotatedFootprint })', { Math, Number, Object }
);

test('product swaps convert inches to feet and reject missing/invalid dimensions', () => {
  const { resolveProductDimensions } = dimensionsHelpers;
  const vanity = resolveProductDimensions('vanity', { footprint_in: { width: 60, depth: 24 } });
  assert.equal(vanity.width, 5); assert.equal(vanity.depth, 2);
  assert.equal(vanity.scale[0], 5 / 3.5);
  assert.equal(vanity.scale[1], 1, 'Horizontal footprint does not stretch height');
  const tub = resolveProductDimensions('bathtub', { footprint_in: { width: '72', depth: 36 } });
  assert.equal(tub.width, 6); assert.equal(tub.depth, 3);
  const invalid = resolveProductDimensions('toilet', { footprint_in: { width: -2, depth: '--' } });
  assert.equal(invalid.width, 1.5); assert.equal(invalid.depth, 2.4);
  const missing = resolveProductDimensions('shower');
  assert.equal(missing.width, 3.8);
});

test('showerhead footprints scale the head, while enclosure footprints scale the enclosure', () => {
  const { resolveProductDimensions } = dimensionsHelpers;
  const head = resolveProductDimensions('shower', { footprint_in: { width: 6, depth: 6 } });
  assert.equal(head.width, 3.8); assert.equal(head.headScale[0], 0.5 / 1.4);
  const enclosure = resolveProductDimensions('shower', { footprint_in: { width: 48, depth: 60 } });
  assert.equal(enclosure.width, 4); assert.equal(enclosure.depth, 5);
  assert.equal(enclosure.headScale[0], 1);
});

test('analytic picking ignores detailed child meshes and respects rotated product bounds', () => {
  const c = setup('DraggableFixture', '// Scene Background', {
    dimensions: { width: 6, depth: 2, height: 3 }, rotation: 90
  });
  const group = c.refs[0].current;
  group.raycast = c.result.pickFixture;
  let detailedTests = 0;
  const detail = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  detail.raycast = () => { detailedTests++; };
  group.add(detail); group.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 1, 8), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(group, true);
  assert.equal(hits.length, 1); assert.equal(detailedTests, 0);
  assert.ok(Math.abs(hits[0].point.z - 3) < 1e-8);
  raycaster.ray.origin.x = 1.1;
  assert.equal(raycaster.intersectObject(group, true).length, 0);
  c.cleanup();
});

test('drag clamps the complete rotated footprint inside the room', () => {
  const c = setup('DraggableFixture', '// Scene Background', {
    dimensions: { width: 6, depth: 2, height: 3 }, rotation: 90
  });
  grab(c);
  c.canvas.emit('pointermove', { pointerId: 1, clientX: 50000, clientY: 350 }); c.frame();
  assert.ok(Math.abs(c.refs[0].current.position.x) <= 6.94 + 1e-8);
  assert.ok(Math.abs(c.refs[0].current.position.z) <= 3.94 + 1e-8);
  c.window.emit('pointerup', { pointerId: 1, clientX: 50000, clientY: 350 });
  assert.equal(c.commits.length, 1);
  c.cleanup();
});

test('Eye entry and recording pause mutate no React state and preserve camera while paused', () => {
  const c = setup('VRWalkthroughController', 'function WalkthroughMouseLook', {
    enabled: true, startAtEntry: false, paused: true
  });
  assert.equal(c.camera.position.x, 0); assert.equal(c.camera.position.z, 5.8);
  const before = c.camera.position.clone();
  c.window.emit('keydown', { code: 'KeyW' }); c.frame();
  assert.equal(c.camera.position.distanceTo(before), 0);
  c.cleanup();
});

test('application wiring follows singular suite keys and resolves catalog footprint fallbacks', () => {
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const code = app.slice(app.indexOf('  const studioProducts ='), app.indexOf('  const handleExportPDF ='));
  const catalog = { vanities: [{ id: 'wide', footprint_in: { width: 60, depth: 24 } }],
    bathtubs: [{ id: 'tub', footprint_in: { width: 72, depth: 36 } }] };
  const evaluate = currentTierData => vm.runInNewContext(code + '\nstudioProducts', {
    catalog, currentTierData, useMemo: fn => fn(), Object
  });
  const suite = evaluate({ bundle: { vanity: 'wide', bathtub: 'tub' },
    detailed_bundle: { vanity: { id: 'wide', name: 'Hydrated vanity' } } });
  assert.equal(suite.vanities.name, 'Hydrated vanity');
  assert.equal(suite.vanities.footprint_in.width, 60);
  assert.equal(suite.bathtubs.footprint_in.depth, 36);
  const override = evaluate({ bundle: { vanity: 'wide' },
    detailed_bundle: { vanity: { footprint_in: { width: 48, depth: 21 } } } });
  assert.equal(override.vanities.footprint_in.width, 48);
  assert.equal(evaluate({}).vanities.footprint_in, undefined);
});

test('responsive framing keeps every room corner in the frustum, including portrait previews', () => {
  const cameraSource = source.slice(source.indexOf('function fitStudioCamera('), source.indexOf('function PlanCamera('));
  const fit = vm.runInNewContext(cameraSource + '\nfitStudioCamera', { THREE, Math });
  for (const aspect of [0.4, 1, 1.5, 2.4]) for (const top of [false, true]) {
    const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
    fit(camera, 16, 14, aspect, top); camera.updateMatrixWorld();
    for (const x of [-8, 8]) for (const y of [0, 8.5]) for (const z of [-7, 7]) {
      const screen = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(screen.x) < 0.95 && Math.abs(screen.y) < 0.95, `Corner fits aspect ${aspect}, top ${top}`);
      assert.ok(screen.z > -1 && screen.z < 1);
    }
  }
});

test('studio health reports readiness once and exposes context loss and restoration', () => {
  const ready = [], context = [];
  const c = setup('StudioHealth', '// Hide exterior walls', {
    onReady: value => ready.push(value), onContextLost: value => context.push(value)
  });
  const rendererId = c.canvas.getAttribute('data-renderer-id');
  assert.ok(rendererId);
  for (let i = 0; i < 180; i++) c.frame();
  assert.deepEqual(ready, [true], 'No React readiness updates in the ongoing frame loop');
  assert.equal(c.canvas.getAttribute('data-renderer-id'), rendererId);
  assert.ok(Number(c.canvas.getAttribute('data-fps')) >= 59);
  c.canvas.emit('webglcontextlost'); c.canvas.emit('webglcontextrestored');
  assert.deepEqual(context, [true, false]);
  c.cleanup();
  c.canvas.emit('webglcontextlost');
  assert.deepEqual(context, [true, false], 'No listeners remain after unmount');
});

test('Plan uses a finite orthographic projection and fits the entire floor without perspective distortion', () => {
  const code = source.slice(source.indexOf('function fitStudioCamera('), source.indexOf('function PlanCamera('));
  const fit = vm.runInNewContext(code + '\nfitStudioCamera', { THREE, Math, Object });
  for (const aspect of [0.4, 1.5, 2.4]) {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    fit(camera, 16, 14, aspect, true); camera.updateMatrixWorld();
    assert.ok(camera.projectionMatrix.elements.every(Number.isFinite));
    for (const x of [-8, 8]) for (const z of [-7, 7]) {
      const point = new THREE.Vector3(x, 0, z).project(camera);
      assert.ok(Math.abs(point.x) < 0.86 && Math.abs(point.y) < 0.86);
    }
  }
});
