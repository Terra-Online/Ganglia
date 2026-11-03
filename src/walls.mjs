const segmentDistance = (a, b, c, d) => {
  const cross = (p, q, r) => (q[0]-p[0])*(r[1]-p[1]) - (q[1]-p[1])*(r[0]-p[0]);
  const abC = cross(a,b,c), abD = cross(a,b,d), cdA = cross(c,d,a), cdB = cross(c,d,b);
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
      ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0;
  const toSegment = (p, q, r) => {
    const x = r[0]-q[0], z = r[1]-q[1], length = x*x+z*z;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0]-q[0])*x+(p[1]-q[1])*z)/length));
    return Math.hypot(p[0]-q[0]-t*x, p[1]-q[1]-t*z);
  };
  return Math.min(toSegment(a,c,d), toSegment(b,c,d), toSegment(c,a,b), toSegment(d,a,b));
};

/** Segment against conservative air-wall volumes, expanded by player radius/height.
 * Feet positions are expected. Unknown state blocks just like an active wall.
 * Optional XZ polylines narrow the box test. Without them, bounds conservatively block.
 * This test covers vertical air walls, not arbitrary scene collision geometry.
 */
export function blockedByWalls(start, end, walls, { radius, height }) {
  const point = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (!point(start) || !point(end) || !Number.isFinite(radius) || radius < 0 ||
      !Number.isFinite(height) || height <= 0) throw new Error('Invalid wall query');
  let hit = false;
  for (const wall of walls) {
    if (!point(wall.min) || !point(wall.max) || wall.min.some((v, i) => v > wall.max[i]) ||
        !['active', 'inactive', 'unknown'].includes(wall.state) || !Number.isFinite(wall.padding ?? 0) || (wall.padding ?? 0) < 0) throw new Error('Invalid wall');
    if (wall.points !== undefined && (!Array.isArray(wall.points) || wall.points.length < 2 ||
        wall.points.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))) throw new Error('Invalid wall polyline');
    if (wall.state === 'inactive') continue;
    const margin = radius + (wall.padding ?? 0);
    const min = wall.min.map((v, i) => v - (i === 1 ? height : margin));
    const max = wall.max.map((v, i) => v + (i === 1 ? 0 : margin));
    let near = 0, far = 1;
    for (let i = 0; i < 3; i++) {
      const delta = end[i] - start[i];
      if (Math.abs(delta) < 1e-12) {
        if (start[i] < min[i] || start[i] > max[i]) { far = -1; break; }
      } else {
        const a = (min[i] - start[i]) / delta, b = (max[i] - start[i]) / delta;
        near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
      }
    }
    if (near > far) continue;
    if (!wall.points) { hit = true; continue; }
    // Clip to vertical overlap before comparing XZ distances. A lower/upper walkway
    // may pass the same wall footprint without intersecting its collision height.
    let low = 0, high = 1;
    const dy = end[1] - start[1];
    if (Math.abs(dy) >= 1e-12) {
      const a = (min[1]-start[1])/dy, b = (max[1]-start[1])/dy;
      low = Math.max(0, Math.min(a,b)); high = Math.min(1, Math.max(a,b));
    }
    const a = [0,2].map(i => start[i] + low*(end[i]-start[i]));
    const b = [0,2].map(i => start[i] + high*(end[i]-start[i]));
    for (let i = 1; i < wall.points.length; i++) {
      if (segmentDistance(a, b, wall.points[i-1], wall.points[i]) <= margin + 1e-9) hit = true;
    }
  }
  return hit;
}
