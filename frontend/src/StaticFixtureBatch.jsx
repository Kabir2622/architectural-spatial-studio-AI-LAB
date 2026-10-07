import { useLayoutEffect, useRef } from 'react';
import { batchFixtureMeshes } from './fixtureBatching';

export default function StaticFixtureBatch({ children }) {
  const root = useRef(null);
  useLayoutEffect(() => batchFixtureMeshes(root.current), [children]);
  return <group ref={root}>{children}</group>;
}
