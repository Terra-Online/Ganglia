import { init } from '@recast-navigation/core';

import { clipSurface, tolerance } from './clip-surface.mjs';
import { buildSupportField } from './support-field.mjs';

function validateGeometry(geometry, allowEmpty = false) {
  const { positions, indices } = geometry ?? {};
  if (!positions || !indices || positions.length % 3 || indices.length % 3 ||
      (!allowEmpty && (positions.length < 9 || indices.length < 3)) ||
      (indices.length > 0 && positions.length < 9)) throw new Error('Invalid collision geometry');
  for (const value of positions) if (!Number.isFinite(value)) throw new Error('Non-finite collision vertex');
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= positions.length / 3) throw new Error('Invalid collision index');
  }
}

function validateOptions(options) {
  const { profile, maxSlope, stepUp, stepDown, cellSize, cellHeight } = options ?? {};
  if (!profile || ![profile.radius, profile.height, cellSize, cellHeight].every(value => Number.isFinite(value) && value > 0) ||
      profile.height < 2 * profile.radius || !Number.isFinite(maxSlope) || maxSlope <= 0 || maxSlope >= 90 ||
      ![stepUp, stepDown].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Invalid ground build profile');
  const height = Math.ceil(profile.height / cellHeight), radius = Math.ceil(profile.radius / cellSize);
  const climb = Math.max(0, Math.floor(Math.min(stepUp, stepDown) / cellHeight) - 1);
  if (height < 3 || height > 255 || radius > 255 || climb > 255) throw new Error('Unsupported ground build voxel profile');
}

function validateBounds(bounds) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max) || bounds.min.length !== 2 || bounds.max.length !== 2 ||
      ![...bounds.min, ...bounds.max].every(Number.isFinite) || bounds.min.some((value, axis) => value >= bounds.max[axis])) {
    throw new Error('Invalid ground build bounds');
  }
}

/** Build player ground surfaces from selected world-space collision triangles.
 * Normals must point out of solids (up for floors). Include ceilings and obstacles,
 * not just floor triangles. This offline entry point does not load through the
 * runtime package root. Returned detail triangles retain sampled ground heights.
 *
 * The importer owns scene/state selection, collision layers, hazards and completeness.
 * Recast approximates a cylinder in a voxel field; its mesh is not a capsule-sweep
 * proof. Ordinary links use the smaller step limit in both directions. Drops and
 * jumps need separately validated directed connections, never automatic gap links.
 */
export async function buildGroundSurfaces(geometry, options) {
  validateGeometry(geometry);
  validateOptions(options);
  const { positions, indices } = geometry;
  const { profile, maxSlope, stepUp, stepDown, cellSize, cellHeight } = options;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  // Expand selected indexed collision to a triangle soup for the native rasterizer.
  const vertices = [];
  for (const i of indices) {
    for (let axis = 0; axis < 3; axis++) {
      const v = positions[i * 3 + axis];
      vertices.push(v); min[axis] = Math.min(min[axis], v); max[axis] = Math.max(max[axis], v);
    }
  }
  // Streamed actors may extend far outside the requested region. Clip the voxel
  // build in XZ, while retaining every input's vertical extent for headroom.
  if (options.bounds !== undefined) {
    const b = options.bounds;
    validateBounds(b);
    min[0] = b.min[0]; min[2] = b.min[1];
    max[0] = b.max[0]; max[2] = b.max[1];
  }
  // Independent tiles must share the same vertical voxel grid, including when
  // their cropped geometry has different lowest vertices.
  min[1] = Math.floor(min[1] / cellHeight) * cellHeight;
  max[1] = Math.ceil(max[1] / cellHeight) * cellHeight;
  const width = Math.ceil((max[0] - min[0]) / cellSize);
  const depth = Math.ceil((max[2] - min[2]) / cellSize);
  if (width < 1 || depth < 1 || width * depth > 8_000_000 || (max[1] - min[1]) / cellHeight > 8190) {
    throw new Error('Collision region exceeds ground build voxel limits; partition the input');
  }
  const height = Math.ceil(profile.height / cellHeight), radius = Math.ceil(profile.radius / cellSize);
  const climb = Math.max(0, Math.floor(Math.min(stepUp, stepDown) / cellHeight) - 1);
  await init();
  return buildSupportField(vertices, [min, max], {
    cs: cellSize, ch: cellHeight, walkableSlopeAngle: maxSlope,
    walkableHeight: height, walkableRadius: radius,
    // Reserve one vertical voxel for rasterization error. The larger downward
    // allowance must not accidentally authorize the same climb in reverse.
    walkableClimb: climb,
    maxSimplificationError: 0.5,
  });
}

function boundaryEdges(surfaces, axis, boundary) {
  const other = axis === 0 ? 2 : 0, edges = [];
  for (const surface of surfaces) {
    for (let i = 0; i < surface.vertices.length; i++) {
      const a = surface.vertices[i], b = surface.vertices[(i + 1) % surface.vertices.length];
      if (Math.abs(a[axis] - boundary) > tolerance || Math.abs(b[axis] - boundary) > tolerance ||
          Math.abs(a[other] - b[other]) <= tolerance) continue;
      edges.push({ id: surface.id, a, b, min: Math.min(a[other], b[other]), max: Math.max(a[other], b[other]) });
    }
  }
  return edges.sort((a, b) => a.min - b.min);
}

function joinTiles(from, to, axis, options) {
  const boundary = from.bounds.max[axis === 0 ? 0 : 1], other = axis === 0 ? 2 : 0;
  const a = boundaryEdges(from.surfaces, axis, boundary), b = boundaryEdges(to.surfaces, axis, boundary);
  const portals = [];
  let first = 0;
  const pointAt = (edge, position) => {
    const ratio = (position - edge.a[other]) / (edge.b[other] - edge.a[other]);
    const point = edge.a.map((value, index) => value + ratio * (edge.b[index] - value));
    point[axis] = boundary;
    point[other] = position;
    return point;
  };
  const connect = (from, to, near, far) => {
    const rise = pointAt(to, near)[1] - pointAt(from, near)[1];
    const delta = pointAt(to, far)[1] - pointAt(from, far)[1] - rise;
    let low = 0, high = 1;
    if (Math.abs(delta) <= 1e-12) {
      if (rise > options.stepUp + tolerance || -rise > options.stepDown + tolerance) return;
    } else {
      const first = (-options.stepDown - rise) / delta, last = (options.stepUp - rise) / delta;
      low = Math.max(0, Math.min(first, last));
      high = Math.min(1, Math.max(first, last));
    }
    const start = near + low * (far - near), end = near + high * (far - near);
    if (end - start <= tolerance) return;
    const entry = [pointAt(from, start), pointAt(from, end)];
    const exit = [pointAt(to, start), pointAt(to, end)];
    portals.push({ from: from.id, to: to.id, entry, exit,
      points: [pointAt(from, (start + end) / 2), pointAt(to, (start + end) / 2)] });
  };
  for (const edge of a) {
    while (first < b.length && b[first].max <= edge.min + tolerance) first++;
    for (let i = first; i < b.length && b[i].min < edge.max - tolerance; i++) {
      const near = Math.max(edge.min, b[i].min), far = Math.min(edge.max, b[i].max);
      if (far - near <= tolerance) continue;
      connect(edge, b[i], near, far);
      connect(b[i], edge, near, far);
    }
  }
  return portals;
}

/** Offline padded builds on one world-space voxel grid. Core clipping removes
 * artificial clearance erosion at tile boundaries. Only overlapping edges on
 * neighboring core boundaries receive directed, step-limited seam transfers.
 * Complete collision geometry and the same state/profile must cover every pad.
 */
export async function buildGroundTiles(geometry, options) {
  validateGeometry(geometry, true);
  validateOptions(options);
  validateBounds(options.bounds);
  const { bounds, cellSize, tileCells } = options;
  if (!Number.isSafeInteger(tileCells) || tileCells < 1) throw new Error('Invalid ground tile cell count');
  const size = tileCells * cellSize;
  if (!Number.isFinite(size)) throw new Error('Invalid ground tile size');
  const gridIndex = (value, round) => {
    const coordinate = value / size, nearest = Math.round(coordinate);
    return Math.abs(value - nearest * size) <= tolerance ? nearest : round(coordinate);
  };
  const minX = gridIndex(bounds.min[0], Math.floor), maxX = gridIndex(bounds.max[0], Math.ceil);
  const minZ = gridIndex(bounds.min[1], Math.floor), maxZ = gridIndex(bounds.max[1], Math.ceil);
  const count = (maxX - minX) * (maxZ - minZ);
  if (![minX, maxX, minZ, maxZ].every(Number.isSafeInteger) || count > 512 || count < 1) {
    throw new Error('Ground build exceeds the 512 tile limit');
  }
  const padding = (Math.ceil(options.profile.radius / cellSize) + 3) * cellSize;
  const { positions, indices } = geometry, triangles = [];
  const extent = { min: [minX * size - padding, minZ * size - padding],
    max: [maxX * size + padding, maxZ * size + padding] };
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const left = Math.min(positions[a], positions[b], positions[c]);
    const right = Math.max(positions[a], positions[b], positions[c]);
    const near = Math.min(positions[a + 2], positions[b + 2], positions[c + 2]);
    const far = Math.max(positions[a + 2], positions[b + 2], positions[c + 2]);
    // Streamed collision batches can contain millions of distant triangles.
    // Reject their packed bounds before allocating any per-triangle objects.
    if (left > extent.max[0] || right < extent.min[0] || near > extent.max[1] || far < extent.min[1]) continue;
    const vertices = Array.from(indices.slice(i, i + 3), index => Array.from(positions.slice(index * 3, index * 3 + 3)));
    triangles.push({ vertices, min: [left, near], max: [right, far] });
  }
  const tiles = [], surfaces = [], portals = [], byPosition = new Map();
  for (let z = minZ; z < maxZ; z++) {
    for (let x = minX; x < maxX; x++) {
      const core = {
        min: [Math.max(bounds.min[0], x * size), Math.max(bounds.min[1], z * size)],
        max: [Math.min(bounds.max[0], (x + 1) * size), Math.min(bounds.max[1], (z + 1) * size)],
      };
      const padded = { min: [x * size - padding, z * size - padding],
        max: [(x + 1) * size + padding, (z + 1) * size + padding] };
      const vertices = [];
      for (const triangle of triangles) {
        if (triangle.min.some((value, axis) => value > padded.max[axis]) ||
            triangle.max.some((value, axis) => value < padded.min[axis])) continue;
        vertices.push(...triangle.vertices.flat());
      }
      const tile = { x, z, bounds: core, surfaces: [] };
      if (vertices.length) {
        let built;
        try {
          built = await buildGroundSurfaces({ positions: vertices, indices: Array.from({ length: vertices.length / 3 }, (_, index) => index) },
            { ...options, bounds: padded });
        } catch (cause) {
          throw new Error(`Ground tile (${x}, ${z}) build failed: ${cause.message}`, { cause });
        }
        for (const surface of built) {
          const clipped = clipSurface(surface.vertices, core);
          if (clipped) tile.surfaces.push({ id: `${x},${z}/${surface.id}`, vertices: clipped });
        }
      }
      tiles.push({ x, z, bounds: core, surfaces: tile.surfaces.length });
      surfaces.push(...tile.surfaces);
      byPosition.set(`${x},${z}`, tile);
      for (const [neighborX, neighborZ, axis] of [[x - 1, z, 0], [x, z - 1, 2]]) {
        const neighbor = byPosition.get(`${neighborX},${neighborZ}`);
        if (neighbor) portals.push(...joinTiles(neighbor, tile, axis, options));
      }
    }
  }
  return { surfaces, portals, tiles };
}
