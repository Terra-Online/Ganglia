import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { jumpDuration } from '../../src/jumps.mjs';

// Fixed supported points from the retained map02_lv004 walking traces.
const points = [
  [-1366.8111572265625, 298.30939069046434, -1651.3255615234375],
  [-1365.0442435400341, 298.32390252428604, -1646.809563397809],
  [-1362.2372548454707, 298.408589740935, -1639.6352708559834],
  [-1361.2443348025865, 298.2999877929687, -1637.0974983056026],
  [-1352.2129972090786, 300.08994098893265, -1640.6660232553477],
  [-1332.5409449892861, 298.3029295480361, -1627.3871537766443],
  [-1328.6625579833985, 294.8500061035156, -1612.9499877929688],
];
const pairs = [[0, 3], [3, 0], [0, 2], [2, 0], [1, 3], [3, 1], [4, 5], [5, 6], [5, 4], [6, 5]];
export const cases = pairs.map(([a, b], i) => ({ id: `ground-${i + 1}`,
  query: { starts: [{ id: 'player', position: points[a], state: 'available', cost: 0 }], goal: points[b] } }));

/** Import this retained physical fixture without depending on Atlos or its CLI.
 * Data stays local; hashes bind the exact input bytes and workload definition. */
export async function loadMap02(dataRoot) {
  const hashes = {};
  const load = async path => {
    const bytes = await readFile(resolve(dataRoot, path));
    hashes[path] = createHash('sha256').update(bytes).digest('hex');
    return JSON.parse(bytes.toString());
  };
  const ground = await load('validation-map02/ground.json');
  const collision = await load('validation-map02/collision.json');
  const movement = await load('routing/movement-settings-current.json');
  const request = await load('validation-map02/walk-request.json');
  if (ground.scene !== 'map02' || collision.scene !== ground.scene || request.scene !== ground.scene ||
      ![collision, movement, request].every(d => isDeepStrictEqual(d.source, ground.source)) ||
      !isDeepStrictEqual(ground.selection, collision.selection) ||
      ![collision.options.profile, movement.defaultProfile].every(p => isDeepStrictEqual(p, ground.options.profile))) {
    throw new Error('map02 inputs must share scene, build, selection and body profile');
  }
  const settings = movement.assets.find(a => a.path.endsWith('/MovementSetting_Default.asset'))?.settings;
  const field = key => {
    const value = settings?.[key];
    if (!Number.isFinite(value)) throw new Error(`Missing movement setting: ${key}`);
    return value;
  };
  const model = { gravity: field('_gravity'), fallingGravity: field('_fallingGravity'),
    maxJumpHeight: field('_maxJumpHeight'), maxFallingSpeed: field('_maxFallingSpeed'),
    apexTime: field('_apexTime'), maxHorizontalSpeed: field('_inAirMaxHorizontalSpeedSprint'),
    startHorizontalSpeed: Math.min(field('_startHorizontalSpeedSprint'), field('_inAirMaxInitHorizontalSpeed')),
    airOverspeedDeceleration: field('_inAirDecelerationWithInputSprint'),
    airAcceleration: field('_inAirAcceleration'), airDeceleration: field('_inAirDecelerationNoInputSprint') };
  let minY = Infinity, maxY = -Infinity;
  for (const surface of ground.surfaces) for (const p of surface.vertices) {
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const maxDrop = maxY - minY;
  const maxHorizontalDistance = jumpDuration(maxDrop, 0, { ...model, mode: 'jump' }) *
    Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed);
  // Match the exporter's non-walkable records: reverse upward faces so they
  // remain double-sided obstacles without granting standing support.
  const indices = collision.indices.slice(), positions = collision.positions;
  for (const record of collision.records) if (record.walkable === false) {
    for (let triangle = record.first; triangle < record.first + record.count; triangle++) {
      const at = triangle * 3, a = indices[at] * 3, b = indices[at + 1] * 3, c = indices[at + 2] * 3;
      const upward = (positions[b + 2] - positions[a + 2]) * (positions[c] - positions[a]) -
        (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]);
      if (upward > 0) [indices[at + 1], indices[at + 2]] = [indices[at + 2], indices[at + 1]];
    }
  }
  const padding = ground.options.profile.radius + Math.hypot(Math.max(model.gravity, model.fallingGravity),
    Math.max(model.airAcceleration, model.airDeceleration)) * 0.1 ** 2 / 8 + 0.01;
  const bounds = { min: ground.build.bounds.min.map(v => v - padding), max: ground.build.bounds.max.map(v => v + padding) };
  const options = { ...ground.options, walls: [...ground.options.walls, ...request.walls],
    locomotion: movement.sustainedSprint, model, runAirSpeed: field('_inAirMaxHorizontalSpeedRun'),
    maxSlope: field('_slopeLimit'), maxDrop, maxHorizontalDistance,
    sampleSpacing: 1, maxCandidates: 128, maxShortcutCandidates: 0, maxLinks: 64 };
  return { input: { surfaces: ground.surfaces, collision: { positions, indices }, collisionOptions: { bounds }, options },
    metadata: { scene: ground.scene, source: ground.source, generator: ground.generator,
      coverage: ground.build.bounds, inputSha256: hashes, surfaces: ground.surfaces.length,
      triangles: indices.length / 3, limits: { maxCandidates: 128, maxShortcutCandidates: 0, maxLinks: 64 },
      scope: 'Fixed map02_lv004 physical window; daytime, fully-enabled snapshot; no devices, boosts, goal refinement or Atlos scheduling.' } };
}
