import { useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { specializePhysicalMaterial } from './materialSpecialization';

export default function StudioMaterialBudget() {
  const { scene } = useThree();
  const optimized = useRef(new Map());
  useFrame(() => {
    const seen = new Set();
    scene.traverseVisible(object => {
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material?.isMeshPhysicalMaterial || seen.has(material)) continue;
        seen.add(material);
        if (!optimized.current.has(material)) optimized.current.set(material, specializePhysicalMaterial(material));
        optimized.current.get(material).refresh();
      }
    });
    for (const [material, value] of optimized.current) {
      if (!seen.has(material)) { value.dispose(); optimized.current.delete(material); }
    }
  }, -2);
  useLayoutEffect(() => {
    const values = optimized.current;
    return () => { values.forEach(value => value.dispose()); values.clear(); };
  }, [scene]);
  return null;
}
