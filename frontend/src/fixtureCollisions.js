// Separating-axis test for rotated catalog footprints. Touching edges are
// allowed; only actual product overlap is flagged, independently of clearances.
export function doorFootprint(hinge, rotation, width, depth) {
  const angle = rotation * Math.PI / 180;
  return {
    position: { x: hinge.x + width / 2 * Math.cos(angle) + depth / 2 * Math.sin(angle),
      z: hinge.z - width / 2 * Math.sin(angle) + depth / 2 * Math.cos(angle) },
    dimensions: { width, depth }, rotation
  };
}

export function footprintsOverlap(a, b) {
  const aa = (a.rotation || 0) * Math.PI / 180;
  const ba = (b.rotation || 0) * Math.PI / 180;
  const axes = [[Math.cos(aa), -Math.sin(aa)], [Math.sin(aa), Math.cos(aa)],
    [Math.cos(ba), -Math.sin(ba)], [Math.sin(ba), Math.cos(ba)]];
  const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
  for (const [x, z] of axes) {
    const ra = a.dimensions.width / 2 * Math.abs(x * axes[0][0] + z * axes[0][1])
      + a.dimensions.depth / 2 * Math.abs(x * axes[1][0] + z * axes[1][1]);
    const rb = b.dimensions.width / 2 * Math.abs(x * axes[2][0] + z * axes[2][1])
      + b.dimensions.depth / 2 * Math.abs(x * axes[3][0] + z * axes[3][1]);
    if (Math.abs(dx * x + dz * z) >= ra + rb - 0.00001) return false;
  }
  return true;
}

export function overlappingFixtures(fixtures) {
  const flags = {};
  for (const fixture of fixtures) flags[fixture.id] = false;
  for (let i = 0; i < fixtures.length; i++) for (let j = i + 1; j < fixtures.length; j++) {
    if (footprintsOverlap(fixtures[i], fixtures[j])) {
      flags[fixtures[i].id] = true;
      flags[fixtures[j].id] = true;
    }
  }
  return flags;
}
