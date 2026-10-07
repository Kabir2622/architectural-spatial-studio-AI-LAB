import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

// The ground outside this quadrilateral cannot receive a directional shadow.
// Clipping the receiver avoids running its transparent shader across the screen.
export function shadowReceiverGeometry(camera, height) {
  const positions = [];
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const near = new Vector3(x, y, -1).unproject(camera);
    const far = new Vector3(x, y, 1).unproject(camera);
    const direction = far.sub(near);
    if (Math.abs(direction.y) < 1e-8) return null;
    const point = near.addScaledVector(direction, (height - near.y) / direction.y);
    positions.push(point.x, height, point.z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
