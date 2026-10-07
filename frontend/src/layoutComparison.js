// Saved comparisons are independent of the live scene and its drag loop.
export const LAYOUT_STORAGE_KEY = 'kohler.saved-layouts.v1';
export const FIXTURE_LABELS = { bathtub: 'Tub', vanity: 'Vanity', shower: 'Shower', toilet: 'Toilet' };

export function fixtureCorners(position, dimensions, rotation = 0) {
  const angle = rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
    x *= dimensions.width / 2; z *= dimensions.depth / 2;
    return [position[0] + c * x + s * z, position[2] - s * x + c * z];
  });
}

function overlaps(a, b) {
  // Separating-axis test: touching edges are allowed; intersecting footprints are not.
  return [a, b].every(points => points.every((point, i) => {
    const next = points[(i + 1) % points.length];
    const axis = [-(next[1] - point[1]), next[0] - point[0]];
    const project = corners => corners.map(p => p[0] * axis[0] + p[1] * axis[1]);
    const pa = project(a), pb = project(b);
    return Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) > 1e-6;
  }));
}

export function assessClearances(snapshot) {
  const { width, depth, positions, dimensions, rotations } = snapshot;
  const fixtures = Object.keys(positions).map(id => ({ id, corners: fixtureCorners(positions[id], dimensions[id], rotations[id]) }));
  const collisions = [];
  fixtures.forEach((a, i) => fixtures.slice(i + 1).forEach(b => {
    if (overlaps(a.corners, b.corners)) collisions.push([a.id, b.id]);
  }));
  const front = fixtures.map(fixture => {
    const { id } = fixture, shape = dimensions[id], origin = positions[id];
    const angle = rotations[id] * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    const tangent = [c, -s], forward = [s, c];
    // Measure an unobstructed rectangular strip across the fixture's front.
    const start = [origin[0] + forward[0] * shape.depth / 2, origin[2] + forward[1] * shape.depth / 2];
    let distance = Infinity;
    for (const side of [-1, 1]) {
      const point = [start[0] + tangent[0] * side * shape.width / 2, start[1] + tangent[1] * side * shape.width / 2];
      for (const [axis, limit] of [[0, width / 2], [1, depth / 2]]) {
        if (Math.abs(forward[axis]) > 1e-8) distance = Math.min(distance, (Math.sign(forward[axis]) * limit - point[axis]) / forward[axis]);
      }
    }
    for (const other of fixtures.filter(item => item.id !== id)) {
      const local = other.corners.map(p => {
        const x = p[0] - start[0], z = p[1] - start[1];
        return [x * tangent[0] + z * tangent[1], x * forward[0] + z * forward[1]];
      });
      // Clip the rotated obstacle to the front strip before measuring distance.
      let clipped = local;
      for (const [axis, limit, sign] of [[0, -shape.width / 2, 1], [0, shape.width / 2, -1], [1, 0, 1]]) {
        const output = [];
        clipped.forEach((a, i) => {
          const b = clipped[(i + 1) % clipped.length];
          const insideA = sign * (a[axis] - limit) >= 0, insideB = sign * (b[axis] - limit) >= 0;
          if (insideA) output.push(a);
          if (insideA !== insideB) {
            const t = (limit - a[axis]) / (b[axis] - a[axis]);
            output.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
          }
        });
        clipped = output;
      }
      if (clipped.length) distance = Math.min(distance, ...clipped.map(p => p[1]));
    }
    if (collisions.some(pair => pair.includes(id))) distance = 0;
    return { id, inches: Math.max(0, distance * 12) };
  });
  return { collisions, front, constrained: front.filter(item => item.inches < 21).length };
}

export function parseWaterRate(value, unit) {
  if (typeof value !== 'string' || !new RegExp(`\\b${unit}\\b`, 'i').test(value)) return null;
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*GP[MF]\b/i);
  if (!match) return null;
  const first = Number(match[1]);
  // Explicit scenario: two reduced flushes for each full flush.
  return match[2] ? first * 2 / 3 + Number(match[2]) / 3 : first;
}

// Only recover ratings for the exact saved model; never substitute a different
// product or a baseline rate for an unknown fixture.
export function resolveResourceProducts(products = {}, catalog = {}) {
  const categories = { shower: ['showers', 'GPM'], toilet: ['toilets', 'GPF'], faucet: ['faucets', 'GPM'] };
  const resolved = { ...products };
  for (const [id, [category, unit]] of Object.entries(categories)) {
    const saved = products[id] || {};
    if (parseWaterRate(saved.flow_rate, unit) !== null || !saved.id) continue;
    const match = (catalog[category] || []).find(product => product.id === saved.id);
    if (parseWaterRate(match?.flow_rate, unit) !== null) {
      resolved[id] = { ...saved, flow_rate: match.flow_rate };
    }
  }
  return resolved;
}

export function estimateResources(products) {
  const assumptions = { people: 2, showersPerDay: 1, showerMinutes: 8, flushesPerDay: 5, faucetMinutes: 4 };
  const categories = [
    ['shower', 'GPM', 2.5, assumptions.showerMinutes * assumptions.showersPerDay, 0.6],
    ['toilet', 'GPF', 1.6, assumptions.flushesPerDay, 0],
    ['faucet', 'GPM', 2.2, assumptions.faucetMinutes, 0.5]
  ];
  const rows = categories.map(([id, unit, baseline, daily, hotFraction]) => {
    const rate = parseWaterRate(products[id]?.flow_rate, unit);
    const events = daily * assumptions.people * 365;
    const saved = rate === null ? null : (baseline - rate) * events;
    return { id, rate, gallons: rate === null ? null : rate * events, saved,
      // 1 US gallon water ≈ 0.0044 kWh/°C; scenario temperature rise 35°C, efficiency 90%.
      energy: saved === null ? null : saved * hotFraction * 0.0044 * 35 / 0.9 };
  });
  const complete = rows.every(row => row.rate !== null);
  const known = rows.filter(row => row.rate !== null);
  const heating = rows.filter(row => row.id !== 'toilet' && row.rate !== null);
  return { rows, assumptions, complete,
    missing: rows.filter(row => row.rate === null).map(row => row.id),
    knownAnnualGallons: known.length ? known.reduce((sum, row) => sum + row.gallons, 0) : null,
    knownGallonsSaved: known.length ? known.reduce((sum, row) => sum + row.saved, 0) : null,
    knownEnergySaved: heating.length ? heating.reduce((sum, row) => sum + row.energy, 0) : null,
    annualGallons: complete ? rows.reduce((sum, row) => sum + row.gallons, 0) : null,
    gallonsSaved: complete ? rows.reduce((sum, row) => sum + row.saved, 0) : null,
    energySaved: rows.filter(row => row.id !== 'toilet').every(row => row.rate !== null)
      ? rows.reduce((sum, row) => sum + (row.energy ?? 0), 0) : null };
}

export function isValidSnapshot(value) {
  return value && value.version === 1 && typeof value.id === 'string' && typeof value.name === 'string'
    && typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt))
    && Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.depth) && value.depth > 0
    && Object.keys(value.positions || {}).length === Object.keys(FIXTURE_LABELS).length
    && Object.keys(FIXTURE_LABELS).every(id => Array.isArray(value.positions?.[id])
      && value.positions[id].length === 3 && value.positions[id].every(Number.isFinite)
      && Number.isFinite(value.rotations?.[id]) && Number.isFinite(value.dimensions?.[id]?.width)
      && value.dimensions[id].width > 0 && Number.isFinite(value.dimensions[id].depth) && value.dimensions[id].depth > 0)
    && value.products && typeof value.products === 'object';
}
