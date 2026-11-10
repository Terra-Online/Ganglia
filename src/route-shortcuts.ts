import { createBoundsIndex } from './bounds.js';
import { createGoalProjector } from './goals.js';
import { groundPreparation } from './ground.js';
import { jumpConnection, jumpDuration, runOffConnection, createMotionVariants } from './jumps.js';
import { standingFoot, validateDiscovery } from './traversal.js';
import { createWallChecker } from './walls.js';
const distance = (a: any, b: any) =>
  Math.hypot(...a.map((value: any, axis: any) => value - b[axis]));
// The incumbent supplies useful approach and landing neighbourhoods even when
// unrelated mesh boundaries outnumber its corners by several orders of magnitude.
// These samples only propose edges: support, body motion and the final gait-aware
// route comparison remain authoritative.
export function findRouteShortcuts(surfaces: any, world: any, options: any, cache: any): any {
  validateDiscovery(world, options);
  const {
    baseline,
    profile,
    model,
    maxVertical,
    maxSlope,
    maxDrop,
    maxHorizontalDistance,
    maxCandidates,
    maxLinks,
    sampleSpacing,
    walls,
    speed,
  } = options;
  const diagnostics: any = {
    reason: 'route-shortcuts',
    baselineCost: baseline.cost,
    boundaryEdges: 0,
    seedChecks: 0,
    candidatePairs: 0,
    neighbourChecks: 0,
    endpointChecks: 0,
    attempted: 0,
    accepted: 0,
    truncated: false,
    goalFaces: 0,
    rejected: { support: 0, projection: 0, clearance: 0, range: 0, motion: 0, groundDominated: 0 },
    limits: {
      seedChecks: maxCandidates * 4 + baseline.segments.length * 2,
      neighbourChecks: maxCandidates * 64,
      endpointChecks: maxCandidates * 4,
      arcAttempts: maxCandidates * 2,
      maxLinks,
    },
  };
  const length = baseline.segments
    .filter((segment: any) => segment.mode === 'walk')
    .reduce(
      (sum: any, segment: any): any =>
        sum +
        segment.points
          .slice(1)
          .reduce(
            (sum: any, point: any, index: any): any => sum + distance(segment.points[index], point),
            0,
          ),
      0,
    );
  const spacing = Math.max(sampleSpacing, length / (maxCandidates * 4));
  const samples = [];
  let elapsed = 0;
  for (const segment of baseline.segments) {
    if (segment.mode === 'walk') {
      let untilNext = 0;
      for (let index = 1; index < segment.points.length; index++) {
        const a = segment.points[index - 1],
          b = segment.points[index],
          span = distance(a, b);
        if (span === 0) continue;
        while (untilNext < span) {
          const fraction = untilNext / span;
          const point = a.map((value: any, axis: any): any => value + fraction * (b[axis] - value));
          samples.push({
            id: samples.length,
            point,
            time:
              elapsed +
              segment.times[index - 1] +
              fraction * (segment.times[index] - segment.times[index - 1]),
            min: point,
            max: point,
          });
          untilNext += spacing;
        }
        untilNext -= span;
      }
      const point = segment.points.at(-1);
      samples.push({
        id: samples.length,
        point,
        time: elapsed + segment.times.at(-1),
        min: point,
        max: point,
      });
    }
    elapsed += segment.times.at(-1);
  }
  diagnostics.seedChecks = samples.length;
  const query = createBoundsIndex(samples),
    candidates = [];
  const starts = [],
    ranges = [[0, samples.length]];
  for (let index = 0; index < ranges.length; index++) {
    const [low, high] = ranges[index];
    if (low >= high) continue;
    const middle = Math.floor((low + high) / 2);
    starts.push(samples[middle]);
    ranges.push([low, middle], [middle + 1, high]);
  }
  pairing: for (const start of starts) {
    for (const end of query({
      min: [
        start.point[0] - maxHorizontalDistance,
        start.point[1] - maxDrop,
        start.point[2] - maxHorizontalDistance,
      ],
      max: [
        start.point[0] + maxHorizontalDistance,
        start.point[1] + model.maxJumpHeight,
        start.point[2] + maxHorizontalDistance,
      ],
    })) {
      if (diagnostics.neighbourChecks >= diagnostics.limits.neighbourChecks) {
        diagnostics.truncated = true;
        break pairing;
      }
      diagnostics.neighbourChecks++;
      if (end.id <= start.id || end.time <= start.time) continue;
      const span = Math.hypot(end.point[0] - start.point[0], end.point[2] - start.point[2]);
      const durations = (model.maxJumpHeight > 0 ? ['drop', 'jump'] : ['drop'])
        .map((mode): any => jumpDuration(start.point[1], end.point[1], { ...model, mode }))
        .filter(
          (duration) =>
            duration !== null && duration > 0 && span <= duration * model.maxHorizontalSpeed,
        );
      if (!durations.length) continue;
      const saving = end.time - start.time - Math.min(...durations);
      if (saving > 1e-7) candidates.push({ start, end, saving });
    }
  }
  candidates.sort((a, b) => b.saving - a.saving);
  diagnostics.candidatePairs = candidates.length;
  if (candidates.length > maxCandidates) diagnostics.truncated = true;
  if (!candidates.length) return { connections: [], diagnostics };
  const prepared = groundPreparation(options.groundPlanner);
  const project =
    prepared?.surfaces === surfaces ? prepared.projectGoal : createGoalProjector(surfaces);
  const blocked = createWallChecker(walls, profile);
  const cached = cache.standing,
    approaches = cache.approaches;
  const standing = (sample: any): any => {
    const nav = project(sample.point, { maxVertical })[0];
    if (!nav) {
      diagnostics.rejected.projection++;
      return null;
    }
    const key = JSON.stringify([nav.position, nav.surface]);
    if (cached.has(key)) return cached.get(key);
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
      diagnostics.truncated = true;
      return null;
    }
    diagnostics.endpointChecks++;
    const result = standingFoot(nav, world, { profile, maxVertical, maxSlope, blocked, project });
    if (result.reason) diagnostics.rejected[result.reason]++;
    const foot = result.reason ? null : result;
    cached.set(key, foot);
    return foot;
  };
  const variants = createMotionVariants(model, world, profile, cache.exits, approaches);
  const connections = [],
    accepted = new Set<any>();
  let pending = candidates.slice(0, maxCandidates).map((candidate): any => ({ candidate }));
  validation: while (pending.length) {
    const next = [];
    for (const entry of pending) {
      if (
        diagnostics.attempted >= diagnostics.limits.arcAttempts ||
        connections.length >= maxLinks
      ) {
        diagnostics.truncated = true;
        break validation;
      }
      if (entry.key && accepted.has(entry.key)) continue;
      if (!entry.variants) {
        const start = standing(entry.candidate.start),
          end = standing(entry.candidate.end);
        if (!start || !end) continue;
        const key = JSON.stringify([start.position, end.position]);
        if (accepted.has(key)) continue;
        const ground = prepared?.straighten.trace(start.position, end.position);
        const groundTime = ground
          ? ground
              .slice(1)
              .reduce(
                (sum: any, point: any, index: any): any => sum + distance(ground[index], point),
                0,
              ) / speed
          : Infinity;
        Object.assign(entry, {
          start,
          end,
          key,
          groundTime,
          variants: variants(start.position, end.position),
        });
      }
      const variant = entry.variants.next();
      if (variant.done) continue;
      if (variant.value.mode === 'jump' && model.maxJumpHeight === 0) {
        next.push(entry);
        continue;
      }
      const { start, end, key, groundTime } = entry;
      const duration = jumpDuration(start.position[1], end.position[1], {
        ...model,
        mode: variant.value.mode,
      });
      if (
        duration !== null &&
        duration > 0 &&
        duration < groundTime &&
        duration < entry.candidate.end.time - entry.candidate.start.time
      ) {
        diagnostics.attempted++;
        const motion = {
          ...model,
          ...variant.value,
          profile,
          walls,
          wallCheck: blocked,
          sweep: (a: any, b: any, body: any): any => world.sweepCapsule(a, b, body),
        };
        const arc =
          variant.value.mode === 'drop'
            ? runOffConnection(
                start.position,
                end.position,
                { ...motion, world, maxSlope },
                approaches,
              )
            : jumpConnection(start.position, end.position, motion);
        if (arc && arc.times.at(-1) < entry.candidate.end.time - entry.candidate.start.time) {
          connections.push({
            id: `route-shortcut/${connections.length}`,
            ...arc,
            state: 'open',
            endpointTolerance: Math.min(maxVertical, profile.radius),
            fromSurface: start.surface,
            toSurface: end.surface,
          });
          accepted.add(key);
          continue;
        }
        diagnostics.rejected.motion++;
      }
      next.push(entry);
    }
    pending = next;
  }
  diagnostics.accepted = connections.length;
  return { connections, diagnostics };
}
