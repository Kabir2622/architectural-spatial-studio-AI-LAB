import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const materialFields = ['type', 'color', 'emissive', 'emissiveIntensity', 'metalness', 'roughness',
  'clearcoat', 'clearcoatRoughness', 'envMapIntensity', 'bumpScale', 'normalScale', 'specularIntensity',
  'specularColor', 'ior', 'reflectivity', 'opacity', 'side', 'depthTest', 'depthWrite', 'toneMapped',
  'fog', 'map', 'bumpMap', 'roughnessMap', 'normalMap', 'metalnessMap', 'envMap'];

export function batchFixtureMeshes(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map(), replacements = [];
  root.traverse(object => {
    const material = object.material;
    if (!object.isMesh || !object.visible || !material?.isMeshPhysicalMaterial || material.transparent
      || material.transmission > 0 || object.geometry.morphAttributes.position) return;
    const values = materialFields.map(field => {
      const value = material[field];
      return value?.isTexture ? value.uuid : value?.isColor ? value.getHex() : value?.toArray ? value.toArray() : value;
    });
    const key = JSON.stringify([values, object.castShadow, object.receiveShadow, object.layers.mask,
      Object.keys(object.geometry.attributes).sort()]);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(object);
  });
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map(mesh => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(value => value.dispose());
    if (!geometry) continue;
    geometry.computeBoundingSphere();
    const batch = new THREE.Mesh(geometry, meshes[0].material);
    batch.castShadow = meshes[0].castShadow;
    batch.receiveShadow = meshes[0].receiveShadow;
    batch.layers.mask = meshes[0].layers.mask;
    batch.matrixAutoUpdate = false;
    root.add(batch);
    meshes.forEach(mesh => { mesh.visible = false; });
    replacements.push({ batch, meshes });
  }
  return () => replacements.forEach(({ batch, meshes }) => {
    root.remove(batch);
    batch.geometry.dispose();
    meshes.forEach(mesh => { mesh.visible = true; });
  });
}
