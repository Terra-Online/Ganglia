import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import type { CollisionGeometry, Vec3, Surface } from '../../src/geo/geometry.ts';
import type { Wall } from '../../src/geo/walls.ts';
import { jumpDuration } from '../../src/motion/jumps.ts';
import type { LocomotionOptions } from '../../src/resource/locomotion.ts';
import type { GroundOptions } from '../../src/route/ground.ts';
import type { SceneInput, RouteQuery } from '../../src/solver/contract.ts';
// Use separated ground regions to exercise motion discovery rather than only
// tracing a continuous walking corridor.
const starts: Vec3[] = [
  [-1366.8111572265625, 298.30939069046434, -1651.3255615234375],
  [-1365.728841593561, 298.2359158252343, -1650.1884019657384],
  [-1364.8225342187332, 298.2874792074344, -1649.2361694911501],
  [-1363.4598025417752, 298.32756329287344, -1647.8043844334636],
  [-1362.6261134560978, 298.29998779296875, -1646.9284500174579],
  [-1361.3796878411035, 298.41799334248697, -1645.6188645713705],
  [-1360.1232969113498, 298.59382142177685, -1644.2988088404802],
  [-1358.7985034408428, 298.5352257735265, -1643.5513913244745],
  [-1357.343889341258, 298.2999877929687, -1642.8973274087675],
  [-1355.8931875032279, 298.75000000000006, -1642.2450226325548],
  [-1354.7370750948073, 299.27100797812903, -1641.7251793221778],
  [-1353.1641559092448, 299.86030891540963, -1641.0511041027085],
  [-1351.9306104215614, 300.074589767901, -1640.551697703364],
  [-1350.288868698054, 300.05910379729636, -1639.88703123506],
  [-1349.275412169821, 300.0765493915554, -1639.476728833802],
  [-1347.6915058721459, 300.03052439799535, -1638.8354772959226],
  [-1345.6898066143326, 300.02860334978436, -1638.0250804123891],
  [-1344.7892741786313, 300.0499877929688, -1637.660495834279],
  [-1342.126895034264, 300.0499877929687, -1636.5826197482693],
  [-1341.6032964378503, 300.04998779296875, -1636.370638518272],
  [-1340.0794983650503, 300.27594114825723, -1635.7537220636589],
  [-1338.780316223108, 299.8790518656247, -1634.8836036069722],
  [-1337.8221761255963, 299.5712858305409, -1633.7277318068327],
  [-1336.8262150844166, 299.2228534910895, -1632.5262339418266],
  [-1335.8465725373167, 299, -1631.344422224156],
];
const goals: Vec3[] = [
  [-1353.8500162760417, 255.5918888481963, -1595.5567172037229],
  [-1368.8500162760417, 285.5652965570961, -1586.199951171875],
];
export const cases: { id: string; horizontalDistance: number; query: RouteQuery }[] =
  starts.flatMap((position, start) =>
    goals.map((goal, target) => ({
      id: `ground-jump-${start + 1}-${target + 1}`,
      horizontalDistance: Math.hypot(goal[0] - position[0], goal[2] - position[2]),
      query: { starts: [{ id: 'player', position, state: 'available', cost: 0 }], goal },
    })),
  );
export async function loadMap02(dataRoot: string) {
  const hashes: Record<string, string> = {};
  const load = async <T>(path: string): Promise<T> => {
    const bytes = await readFile(resolve(dataRoot, path));
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    return JSON.parse(bytes.toString()) as T;
  };
  const ground = await load<{
    scene: string;
    source: unknown;
    selection: unknown;
    generator: unknown;
    surfaces: Surface[];
    options: GroundOptions;
    build: { bounds: { min: [number, number]; max: [number, number] } };
  }>('validation-map02/ground.json');
  const collision = await load<
    CollisionGeometry & {
      positions: number[];
      indices: number[];
      scene: string;
      source: unknown;
      selection: unknown;
      options: { profile: GroundOptions['profile'] };
      records: { walkable: boolean; first: number; count: number }[];
    }
  >('validation-map02/collision.json');
  const movement = await load<{
    source: unknown;
    defaultProfile: GroundOptions['profile'];
    assets: { path: string; settings: Record<string, number> }[];
    sustainedSprint: LocomotionOptions;
  }>('routing/movement-settings-current.json');
  const request = await load<{ scene: string; source: unknown; walls: Wall[] }>(
    'validation-map02/walk-request.json',
  );
  if (
    ground.scene !== 'map02' ||
    collision.scene !== ground.scene ||
    request.scene !== ground.scene ||
    ![collision, movement, request].every((d) => isDeepStrictEqual(d.source, ground.source)) ||
    !isDeepStrictEqual(ground.selection, collision.selection) ||
    ![collision.options.profile, movement.defaultProfile].every((p) =>
      isDeepStrictEqual(p, ground.options.profile),
    )
  ) {
    throw new Error('map02 inputs must share scene, build, selection and body profile');
  }
  const settings = movement.assets.find((a) =>
    a.path.endsWith('/MovementSetting_Default.asset'),
  )?.settings;
  const field = (key: string) => {
    const value = settings?.[key];
    if (value === undefined || !Number.isFinite(value))
      throw new Error(`Missing movement setting: ${key}`);
    return value;
  };
  const model = {
    gravity: field('_gravity'),
    fallingGravity: field('_fallingGravity'),
    maxJumpHeight: field('_maxJumpHeight'),
    maxFallingSpeed: field('_maxFallingSpeed'),
    apexTime: field('_apexTime'),
    maxHorizontalSpeed: field('_inAirMaxHorizontalSpeedSprint'),
    startHorizontalSpeed: Math.min(
      field('_startHorizontalSpeedSprint'),
      field('_inAirMaxInitHorizontalSpeed'),
    ),
    airOverspeedDeceleration: field('_inAirDecelerationWithInputSprint'),
    airAcceleration: field('_inAirAcceleration'),
    airDeceleration: field('_inAirDecelerationNoInputSprint'),
  };
  let minY = Infinity,
    maxY = -Infinity;
  for (const surface of ground.surfaces)
    for (const p of surface.vertices) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  const maxDrop = maxY - minY;
  const maxHorizontalDistance =
    jumpDuration(maxDrop, 0, { ...model, mode: 'jump' })! *
    Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed);
  // Match the exporter's non-walkable records: reverse upward faces so they
  // remain double-sided obstacles without granting standing support.
  const indices = collision.indices.slice(),
    positions = collision.positions;
  for (const record of collision.records)
    if (record.walkable === false) {
      for (let triangle = record.first; triangle < record.first + record.count; triangle++) {
        const at = triangle * 3,
          a = indices[at] * 3,
          b = indices[at + 1] * 3,
          c = indices[at + 2] * 3;
        const upward =
          (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) -
          (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
        if (upward > 0) [indices[at + 1], indices[at + 2]] = [indices[at + 2], indices[at + 1]];
      }
    }
  const padding =
    ground.options.profile.radius +
    (Math.hypot(
      Math.max(model.gravity, model.fallingGravity),
      Math.max(model.airAcceleration, model.airDeceleration),
    ) *
      0.1 ** 2) /
      8 +
    0.01;
  const bounds: NonNullable<SceneInput['collisionOptions']>['bounds'] = {
    min: [ground.build.bounds.min[0] - padding, ground.build.bounds.min[1] - padding],
    max: [ground.build.bounds.max[0] + padding, ground.build.bounds.max[1] + padding],
  };
  const options = {
    ...ground.options,
    walls: [...ground.options.walls, ...request.walls],
    locomotion: movement.sustainedSprint,
    model,
    runAirSpeed: field('_inAirMaxHorizontalSpeedRun'),
    maxSlope: field('_slopeLimit'),
    maxDrop,
    maxHorizontalDistance,
    sampleSpacing: 1,
    maxCandidates: 512,
    maxShortcutCandidates: 0,
    maxLinks: 64,
  };
  const {
    walls,
    connections,
    portals,
    sampleSpacing,
    maxCandidates,
    maxShortcutCandidates,
    maxLinks,
    ...movementConfig
  } = options;
  return {
    input: {
      surfaces: ground.surfaces,
      collision: { positions, indices },
      collisionOptions: { bounds },
      walls,
      connections,
      portals,
      config: {
        movement: movementConfig,
        search: { sampleSpacing, maxCandidates, maxShortcutCandidates, maxLinks },
      },
    },
    metadata: {
      scene: ground.scene,
      source: ground.source,
      generator: ground.generator,
      coverage: ground.build.bounds,
      inputSha256: hashes,
      surfaces: ground.surfaces.length,
      workload: 'map02-ground-jumps-v2',
      triangles: indices.length / 3,
      limits: { maxCandidates: 512, maxShortcutCandidates: 0, maxLinks: 64 },
      scope:
        'Fixed map02_lv004 physical window; daytime, fully-enabled snapshot; no devices, boosts, goal refinement or Atlos scheduling.',
    },
  };
}
