const modes = new Set(['walk', 'rope', 'jump', 'drop', 'launch']);
const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

// Shared by graph and grounded-connection import. Sample times are measured from
// segment entry, not global time; they preserve acceleration and pauses in a path.
export function validateMotion({ mode = 'walk', points, times, cost, connection, requiredGait }) {
  if (!modes.has(mode) || (connection !== undefined && (typeof connection !== 'string' || !connection)) ||
      (requiredGait !== undefined && (requiredGait !== 'sprint' || mode === 'walk'))) {
    throw new Error('Invalid movement segment');
  }
  if (times === undefined) {
    if (mode !== 'walk') throw new Error('Non-walking movement requires sample times');
    return;
  }
  if (!Array.isArray(times) || times.length !== points.length || times[0] !== 0 ||
      !times.every(Number.isFinite) || Math.abs(times.at(-1) - cost) > 1e-7 ||
      (mode !== 'walk' && cost <= 0) || times.some((t, i) => t < 0 || (i > 0 && t < times[i - 1])) ||
      times.some((t, i) => i > 0 && t === times[i - 1] && distance(points[i], points[i - 1]) > 1e-9)) {
    throw new Error('Invalid movement timing');
  }
}

export function routeSegment(edge) {
  const times = edge.times ? [...edge.times] : [0];
  if (!edge.times) {
    let length = 0;
    for (let i = 1; i < edge.points.length; i++) {
      length += distance(edge.points[i - 1], edge.points[i]); times.push(length);
    }
    for (let i = 1; i < times.length; i++) times[i] = length ? times[i] / length * edge.cost : edge.cost;
  }
  return { mode: edge.mode ?? 'walk', points: edge.points.map(p => [...p]), times,
    ...(edge.connection === undefined ? {} : { connection: edge.connection }),
    ...(edge.requiredGait === undefined ? {} : { requiredGait: edge.requiredGait }) };
}

/** Sample the timed movement after the selected arrival has completed. Entry/teleport
 * overhead stays in route.arrivalCost; no flight is drawn from the player's old position.
 * This interpolates supplied trajectory samples, not a newly fitted parabola or spline.
 */
export function sampleJourney(route, seconds) {
  if (route.status !== 'complete' || !Number.isFinite(seconds)) throw new Error('Invalid journey sample');
  let remaining = Math.max(0, seconds);
  for (const segment of route.segments) {
    const duration = segment.times.at(-1);
    if (remaining < duration) {
      for (let i = 1; i < segment.times.length; i++) {
        if (remaining < segment.times[i]) {
          const fraction = (remaining - segment.times[i - 1]) / (segment.times[i] - segment.times[i - 1]);
          return { mode: segment.mode,
            position: segment.points[i - 1].map((v, axis) => v + (segment.points[i][axis] - v) * fraction),
            ...(segment.connection === undefined ? {} : { connection: segment.connection }) };
        }
      }
    }
    remaining -= duration;
  }
  return { mode: 'complete', position: [...route.points.at(-1)] };
}
