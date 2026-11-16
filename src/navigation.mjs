// Shared, deterministic autonomous navigation logic (CJS so node:test can run without a bundler).
const WORLD_SIZE = 240;
const GRID_STEP = 4;
const HALF = WORLD_SIZE / 2;

function seededRandom(seed) {
  let s = seed >>> 0;
  return function random() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }

function buildTerrain(seed = 3427) {
  const random = seededRandom(seed);
  const craters = [];
  const radii = [8, 10, 7, 13, 9, 12, 8, 11, 7, 10, 9, 8, 13, 7, 10, 12, 9, 7, 11, 10, 8, 12, 9, 7];
  for (let i = 0; i < radii.length; i++) {
    let placed = false;
    for (let tries = 0; tries < 300 && !placed; tries++) {
      const x = -106 + random() * 212;
      const z = -105 + random() * 210;
      const r = radii[i];
      const start = { x: -108, z: -108 };
      if (distance({ x, z }, start) < r + 17) continue;
      if (craters.some(c => distance(c, { x, z }) < c.radius + r + 5)) continue;
      craters.push({ id: i + 1, x, z, radius: r, depth: r * (0.23 + random() * 0.13) });
      placed = true;
    }
  }
  const deposits = [];
  for (let i = 0; i < 15; i++) {
    for (let tries = 0; tries < 400; tries++) {
      const point = { id: i + 1, x: -103 + random() * 206, z: -101 + random() * 202, confidence: Math.round(8100 + random() * 1700) };
      if (craters.some(c => distance(c, point) < c.radius + 8)) continue;
      if (deposits.some(d => distance(d, point) < 16)) continue;
      deposits.push(point); break;
    }
  }
  return { craters, deposits };
}

function isSafe(point, craters, clearance = 3.7) {
  return Math.abs(point.x) <= HALF - 3 && Math.abs(point.z) <= HALF - 3 &&
    craters.every(c => distance(point, c) >= c.radius + clearance);
}
function nodeToWorld(col, row) { return { x: -HALF + col * GRID_STEP, z: -HALF + row * GRID_STEP }; }
function worldToNode(p) {
  return { col: Math.max(0, Math.min(60, Math.round((p.x + HALF) / GRID_STEP))), row: Math.max(0, Math.min(60, Math.round((p.z + HALF) / GRID_STEP))) };
}
function key(c, r) { return `${c},${r}`; }
function closestSafeNode(point, craters) {
  const node = worldToNode(point);
  if (isSafe(nodeToWorld(node.col, node.row), craters)) return node;
  let best = null; let bestDist = Infinity;
  for (let row = 1; row < 60; row++) for (let col = 1; col < 60; col++) {
    const world = nodeToWorld(col, row);
    if (isSafe(world, craters)) {
      const d = distance(world, point);
      if (d < bestDist) { best = { col, row }; bestDist = d; }
    }
  }
  return best;
}

// A* with 8-way motion and corner-cutting prohibited. Inflated collision radii include rover clearance.
function findRoute(start, end, craters) {
  const src = closestSafeNode(start, craters);
  const dst = closestSafeNode(end, craters);
  if (!src || !dst) return [];
  const startId = key(src.col, src.row);
  const targetId = key(dst.col, dst.row);
  const open = [src];
  const visited = new Set();
  const came = new Map();
  const g = new Map([[startId, 0]]);
  const f = new Map([[startId, Math.hypot(src.col - dst.col, src.row - dst.row)]]);
  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  while (open.length) {
    let bestIndex = 0;
    for (let i = 1; i < open.length; i++) if ((f.get(key(open[i].col,open[i].row)) ?? Infinity) < (f.get(key(open[bestIndex].col,open[bestIndex].row)) ?? Infinity)) bestIndex = i;
    const current = open.splice(bestIndex, 1)[0];
    const currentId = key(current.col,current.row);
    if (currentId === targetId) {
      const path = [nodeToWorld(current.col, current.row)];
      let cursor = currentId;
      while (came.has(cursor)) {
        cursor = came.get(cursor);
        const [c,r] = cursor.split(',').map(Number);
        path.push(nodeToWorld(c,r));
      }
      return path.reverse();
    }
    visited.add(currentId);
    for (const [dc,dr] of directions) {
      const col = current.col + dc; const row = current.row + dr;
      if (col < 1 || col >= 60 || row < 1 || row >= 60) continue;
      if (!isSafe(nodeToWorld(col,row),craters)) continue;
      if (dc && dr && (!isSafe(nodeToWorld(current.col+dc,current.row),craters) || !isSafe(nodeToWorld(current.col,current.row+dr),craters))) continue;
      const id = key(col,row);
      if (visited.has(id)) continue;
      const tentative = (g.get(currentId) ?? Infinity) + Math.hypot(dc,dr);
      if (tentative >= (g.get(id) ?? Infinity)) continue;
      came.set(id,currentId); g.set(id,tentative);
      f.set(id,tentative + Math.hypot(col - dst.col, row - dst.row));
      if (!open.some(p=>p.col===col && p.row===row)) open.push({col,row});
    }
  }
  return [];
}

// Alternating sweep lines cover the finite demo sector, not the actual Moon.
function buildSweep(craters) {
  const waypoints = [];
  let rowNum = 0;
  for (let z = -105; z <= 106; z += 12) {
    const row = [];
    for (let x = -106; x <= 106; x += 12) if (isSafe({x,z},craters, 5.5)) row.push({x,z});
    if (rowNum++ % 2 === 1) row.reverse();
    waypoints.push(...row);
  }
  return waypoints;
}

// World distance scale: 240 scene units = 2.4 km, a 2.4km × 2.4km demo sector.
function simulatedCoordinates(p) {
  return {
    latitude: -85.1 - p.z / 1500,
    longitude: 23.4 + p.x / 500
  };
}

export { WORLD_SIZE, GRID_STEP, seededRandom, distance, buildTerrain, isSafe, findRoute, buildSweep, simulatedCoordinates };
