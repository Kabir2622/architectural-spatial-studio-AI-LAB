import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StudioRenderPass } from '../src/StudioRenderPass.js';
import { specializePhysicalMaterial } from '../src/materialSpecialization.js';
import { shadowReceiverGeometry } from '../src/shadowReceiverGeometry.js';

test('depth prepass excludes glass and fading walls and restores scene and shadow updates', () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  scene.background = new THREE.Color('#0a0d14');
  const make = options => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial(options));
  const opaque = make({}), glass = make({ transmission: 1, transparent: true }), faded = make({ transparent: true, opacity: 0.08 });
  const hidden = make({}); hidden.visible = false;
  scene.add(opaque, glass, faded, hidden);
  const background = scene.background;
  const calls = [];
  const renderer = { autoClear: true, autoClearDepth: true, autoClearColor: true, autoClearStencil: false,
    shadowMap: { autoUpdate: false, needsUpdate: true }, setRenderTarget() {}, clear() {},
    render(value) { calls.push({ depth: Boolean(value.overrideMaterial), glass: glass.visible,
      faded: faded.visible, hidden: hidden.visible, shadow: this.shadowMap.needsUpdate }); } };
  const pass = new StudioRenderPass(scene, camera);
  pass.render(renderer, {}, {});
  assert.deepEqual(calls, [
    { depth: true, glass: false, faded: false, hidden: false, shadow: false },
    { depth: false, glass: true, faded: true, hidden: false, shadow: true }
  ]);
  assert.equal(scene.background, background);
  assert.equal(scene.overrideMaterial, null);
  assert.equal(renderer.autoClear, true);
  assert.equal(renderer.autoClearDepth, true);
  pass.dispose();
});

test('finish specialization recompiles when a finish changes and preserves original shader hooks', () => {
  const material = new THREE.MeshPhysicalMaterial({ metalness: 1, roughness: 0.2 });
  const hook = shader => { shader.fragmentShader += '\n// original hook'; };
  material.onBeforeCompile = hook;
  const optimized = specializePhysicalMaterial(material);
  const firstKey = material.customProgramCacheKey();
  material.roughness = 0.8;
  optimized.refresh();
  assert.notEqual(material.customProgramCacheKey(), firstKey);
  const shader = { fragmentShader: 'uniform float roughness; uniform float metalness;' };
  material.onBeforeCompile(shader, {});
  assert.ok(shader.fragmentShader.includes('0.800000000'));
  assert.ok(shader.fragmentShader.includes('// original hook'));
  assert.equal(material.roughness, 0.8);
  assert.equal(material.metalness, 1);
  optimized.dispose();
  assert.equal(material.onBeforeCompile, hook);
});

test('clipped ground receiver covers the complete directional shadow projection with upward normals', () => {
  const light = new THREE.DirectionalLight();
  light.position.set(8, 14, 8);
  Object.assign(light.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 0.5, far: 60 });
  light.shadow.camera.updateProjectionMatrix();
  light.updateWorldMatrix(true, false);
  light.target.updateWorldMatrix(true, false);
  light.shadow.updateMatrices(light);
  const geometry = shadowReceiverGeometry(light.shadow.camera, -0.189);
  const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
  const expected = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < positions.count; i++) {
    assert.ok(Math.abs(positions.getY(i) + 0.189) < 1e-6);
    assert.ok(normals.getY(i) > 0.99);
    const point = new THREE.Vector3().fromBufferAttribute(positions, i).project(light.shadow.camera);
    assert.ok(Math.abs(point.x - expected[i][0]) < 1e-6);
    assert.ok(Math.abs(point.y - expected[i][1]) < 1e-6);
  }
  geometry.dispose();
});
