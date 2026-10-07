import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { overlappingFixtures } from './fixtureCollisions';

export function FixtureCollisionMonitor({ fixtures, onChange }) {
  const previous = useRef('');
  useFrame(() => {
    const records = Array.from(fixtures.current, ([id, value]) => ({
      id, ...(value.getFootprint ? value.getFootprint() : {
        dimensions: value.dimensions, rotation: value.rotation, position: value.object.position
      })
    }));
    const flags = overlappingFixtures(records);
    const signature = records.map(item => `${item.id}:${flags[item.id]}`).join(',');
    if (signature !== previous.current) {
      previous.current = signature;
      // Update React only when a collision starts/ends, never for drag positions.
      onChange(flags);
    }
  });
  return null;
}

export function FixtureCollisionHighlight({ overlapping, children }) {
  const root = useRef(null);
  useLayoutEffect(() => {
    if (!overlapping) return;
    const replacements = [];
    root.current.traverse(object => {
      if (!object.isMesh || Array.isArray(object.material) || !object.material?.isMeshPhysicalMaterial) return;
      const original = object.material;
      const tint = original.clone();
      tint.color.set('#ef4444');
      tint.emissive.set('#b91c1c');
      tint.emissiveIntensity = 0.55;
      Object.assign(object, { material: tint });
      replacements.push({ object, original, tint });
    });
    return () => replacements.forEach(({ object, original, tint }) => {
      Object.assign(object, { material: original });
      tint.dispose();
    });
  }, [overlapping, children]);
  return <group ref={root}>{children}</group>;
}
