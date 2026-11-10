import { retimeGroundRoute } from './locomotion.mjs';
import { groundPreparation } from './ground.mjs';
import { groundComponents, condenseComponents, canReach } from './connectivity.mjs';

const distance = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
const pointsOf = (segments, start) => segments.length
  ? [segments[0].points[0], ...segments.flatMap(s => s.points.slice(1))] : [start];

/** Compare a selected action excursion with supported walking, including across
 * local-query seams. No airborne motion is cut in half. The supplied immutable
 * ground planner must cover this route and use the same walls/body constraints.
 * This bounded improvement pass does not establish global optimality. */
export function pruneGroundDetours(route, planner, locomotion, { maxQueries = 48 } = {}) {
  if (!Number.isInteger(maxQueries) || maxQueries < 0) throw new Error('Invalid detour query budget');
  let best = route, replacements = 0, queries = 0;
  // Boost expiry is tied to the original event timeline. Keep that evidence until
  // a replacement can explicitly repropagate boost activation and expiry.
  if (route.status !== 'complete' || route.boosts?.length || route.segments.some(s => s.boost || s.boostExpiry !== undefined)) {
    return { route, replacements, queries };
  }
  const scheduled = retimeGroundRoute(route, locomotion);
  if (scheduled.status !== 'complete') return { route, replacements, queries };
  const preparation = groundPreparation(planner);
  // Impossible cross-floor goals must not consume all comparisons before a
  // nearby ground return is considered. Use unfiltered support topology here:
  // conservative blocked polygon centres can still have a valid walking bypass.
  const topology = preparation && condenseComponents(groundComponents(preparation.graph));
  best = scheduled;
  while (queries < maxQueries) {
    const samples = [], elapsed = [0], actions = [0];
    let sinceSample = 0;
    for (let i = 0; i < best.segments.length; i++) {
      const segment = best.segments[i];
      elapsed.push(elapsed[i] + segment.times.at(-1));
      actions.push(actions[i] + (segment.mode === 'walk' ? 0 : 1));
      if (segment.mode !== 'walk') { sinceSample = 0; continue; }
      if (i === 0 || best.segments[i - 1].mode !== 'walk') {
        samples.push({ index: i, point: segment.points[0] }); sinceSample = 0;
      }
      sinceSample += segment.points.slice(1).reduce((sum, p, j) => sum + distance(segment.points[j], p), 0);
      if (sinceSample >= 4 || i === best.segments.length - 1 || best.segments[i + 1].mode !== 'walk') {
        samples.push({ index: i + 1, point: segment.points.at(-1) }); sinceSample = 0;
      }
    }
    if (topology) for (const sample of samples) {
      sample.supports = planner.project(sample.point, { maxVertical: 1e-7 }).map(hit => hit.surface);
    }
    const pairs = [];
    for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
      const from = samples[i], to = samples[j];
      if (actions[to.index] === actions[from.index] ||
          (best.goalHit && best.goalHit.segment >= from.index && best.goalHit.segment < to.index)) continue;
      if (topology && (!from.supports.length || !to.supports.length ||
          !canReach(topology, [], from.supports, new Set(to.supports)))) continue;
      const bound = elapsed[to.index] - elapsed[from.index] - distance(from.point, to.point) /
        Math.max(locomotion.sprintSpeed, locomotion.dash?.speed ?? 0);
      if (bound > 0.01) pairs.push({ from, to, bound });
    }
    pairs.sort((a, b) => b.bound - a.bound);
    let improved = false;
    for (const { from, to } of pairs) {
      if (queries >= maxQueries) break;
      queries++;
      const walk = planner.plan([{ id: '@detour', position: from.point, state: 'available', cost: 0 }], to.point, { connections: [] });
      if (walk.status !== 'complete' || distance(walk.points[0], from.point) > 1e-7 ||
          distance(walk.points.at(-1), to.point) > 1e-7) continue;
      const segments = [...best.segments.slice(0, from.index), ...walk.segments, ...best.segments.slice(to.index)]
        .map(({ gait: _gait, ...segment }) => segment);
      const points = pointsOf(segments, best.points[0]);
      let goalHit = best.goalHit;
      if (goalHit && goalHit.segment >= to.index) goalHit = { ...goalHit,
        segment: goalHit.segment + walk.segments.length - (to.index - from.index) };
      const candidate = retimeGroundRoute({ ...best, points, segments, goalHit,
        length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0) }, locomotion);
      if (candidate.status !== 'complete' || candidate.cost >= best.cost - 0.01) continue;
      best = candidate; replacements++; improved = true; break;
    }
    if (!improved) break;
  }
  return { route: replacements ? best : route, replacements, queries };
}
