import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { batchFixtureMeshes } from '../src/fixtureBatching.js';

test('batching reduces identical draw calls and preserves transformed geometry and materials', () => {
  const root = new THREE.Group();
  root.position.set(3, 1, -2); root.rotation.y = 0.7;
  const nested = new THREE.Group(); nested.rotation.y = 0.3; nested.scale.set(1.5, 1, 0.8); root.add(nested);
  const material = new THREE.MeshPhysicalMaterial({color: '#c5a367', metalness: 1, roughness: 0.2});
  const a = new THREE.Mesh(new THREE.BoxGeometry(), material), b = new THREE.Mesh(new THREE.BoxGeometry(), material.clone());
  a.position.x = -2; b.position.x = 2; nested.add(a, b);
  root.updateWorldMatrix(true, true);
  const expected = new THREE.Box3().setFromObject(root, true);
  const restore = batchFixtureMeshes(root);
  assert.equal(a.visible, false); assert.equal(b.visible, false);
  const batch = root.children.find(value => value.isMesh);
  assert.ok(batch); assert.equal(batch.material, material);
  root.updateWorldMatrix(true, true);
  const actual = new THREE.Box3().setFromObject(batch, true);
  assert.ok(actual.min.distanceTo(expected.min) < 0.000001);
  assert.ok(actual.max.distanceTo(expected.max) < 0.000001);
  assert.equal(batch.geometry.getAttribute('position').count, 72);
  root.position.x += 3; root.updateWorldMatrix(true, true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(batch, true).min.x - expected.min.x - 3) < 0.000001);
  restore();
  assert.equal(a.visible, true); assert.equal(b.visible, true);
  assert.equal(root.children.includes(batch), false);
  assert.equal(a.material, material);
});

test('glass, different finishes, and shadow settings are kept separate', () => {
  const root = new THREE.Group();
  const brass = new THREE.MeshPhysicalMaterial({color: '#c5a367'});
  const materials = [brass, brass.clone(), new THREE.MeshPhysicalMaterial({color: '#111111'}),
    new THREE.MeshPhysicalMaterial({transmission: 1, transparent: true})];
  const meshes = materials.map(value => new THREE.Mesh(new THREE.BoxGeometry(), value));
  meshes[1].castShadow = true;
  root.add(...meshes);
  const restore = batchFixtureMeshes(root);
  assert.equal(meshes.every(value => value.visible), true);
  assert.equal(root.children.length, 4);
  restore();
});
