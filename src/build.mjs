import { init, getNavMeshPositionsAndIndices, freeHeightfield, freeCompactHeightfield,
  freeContourSet, freePolyMesh, freePolyMeshDetail } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

const tolerance = 1e-4;

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
  // The generator's vertex count follows the index count. Expand to a triangle
  // soup so its native rasterizer receives consistent counts for indexed meshes.
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
  const result = generateSoloNavMesh(vertices, Array.from(indices, (_, i) => i), {
    bounds: [min, max],
    cs: cellSize, ch: cellHeight, walkableSlopeAngle: maxSlope,
    walkableHeight: height, walkableRadius: radius,
    // Reserve one vertical voxel for rasterization error. The larger downward
    // allowance must not accidentally authorize the same climb in reverse.
    walkableClimb: climb,
    minRegionArea: 0, mergeRegionArea: 0, maxSimplificationError: 0.5,
    detailSampleDist: 1, detailSampleMaxError: 1,
  }, true);
  try {
    if (!result.success) {
      // A completed empty polygon mesh has no Detour representation. Preserve
      // that proved empty result without concealing a raster/contour failure.
      if (result.error === 'Failed to create Detour navmesh data' && result.intermediates.polyMesh?.npolys() === 0) return [];
      const details = result.intermediates.buildContext.logs.map(entry => entry.msg).join('; ');
      throw new Error('Ground build failed: ' + result.error + (details ? ' (' + details + ')' : ''));
    }
    const [points, triangles] = getNavMeshPositionsAndIndices(result.navMesh);
    const surfaces = [];
    for (let i = 0; i < triangles.length; i += 3) {
      surfaces.push({ id: String(i / 3), vertices: triangles.slice(i, i + 3).map(j => points.slice(j * 3, j * 3 + 3)) });
    }
    return surfaces;
  } finally {
    result.navMesh?.destroy();
    const intermediates = result.intermediates;
    if (intermediates.heightfield) freeHeightfield(intermediates.heightfield);
    if (intermediates.compactHeightfield) freeCompactHeightfield(intermediates.compactHeightfield);
    if (intermediates.contourSet) freeContourSet(intermediates.contourSet);
    if (intermediates.polyMesh) freePolyMesh(intermediates.polyMesh);
    if (intermediates.polyMeshDetail) freePolyMeshDetail(intermediates.polyMeshDetail);
    intermediates.buildContext.destroy();
  }
}

function clipSurface(vertices, bounds) {
  const [a, b, c] = vertices;
  const determinant = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  if (Math.abs(determinant) <= tolerance * tolerance) return null;
  const riseX = ((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])) / determinant;
  const riseZ = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / determinant;
  let clipped = vertices;
  for (const [axis, boundary, keepAbove] of [
    [0, bounds.min[0], true], [0, bounds.max[0], false],
    [2, bounds.min[1], true], [2, bounds.max[1], false],
  ]) {
    const output = [];
    for (let i = 0; i < clipped.length; i++) {
      const from = clipped[i], to = clipped[(i + 1) % clipped.length];
      const fromInside = keepAbove ? from[axis] >= boundary : from[axis] <= boundary;
      const toInside = keepAbove ? to[axis] >= boundary : to[axis] <= boundary;
      if (fromInside) output.push(from);
      if (fromInside !== toInside) {
        const ratio = (boundary - from[axis]) / (to[axis] - from[axis]);
        const point = from.map((value, index) => value + ratio * (to[index] - value));
        point[axis] = boundary;
        output.push(point);
      }
    }
    clipped = output;
  }
  // Recast returns Float32 world coordinates. A vertex just inside a core plane
  // must share that exact grid plane with its clipped neighbors. Preserve the
  // original detail triangle's height while correcting the horizontal rounding.
  clipped = clipped.map(point => {
    const x = Math.abs(point[0] - bounds.min[0]) <= tolerance ? bounds.min[0]
      : Math.abs(point[0] - bounds.max[0]) <= tolerance ? bounds.max[0] : point[0];
    const z = Math.abs(point[2] - bounds.min[1]) <= tolerance ? bounds.min[1]
      : Math.abs(point[2] - bounds.max[1]) <= tolerance ? bounds.max[1] : point[2];
    return [x, a[1] + riseX * (x - a[0]) + riseZ * (z - a[2]), z];
  });
  const points = clipped.filter((point, index) =>
    point.some((value, axis) => Math.abs(value - clipped[(index + clipped.length - 1) % clipped.length][axis]) > tolerance));
  const origin = points[0];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + (point[0] - origin[0]) * (next[2] - origin[2]) - (next[0] - origin[0]) * (point[2] - origin[2]);
  }, 0);
  return points.length >= 3 && Math.abs(area) > tolerance * tolerance ? points : null;
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
  for (const edge of a) {
    while (first < b.length && b[first].max <= edge.min + tolerance) first++;
    for (let i = first; i < b.length && b[i].min < edge.max - tolerance; i++) {
      const near = Math.max(edge.min, b[i].min), far = Math.min(edge.max, b[i].max);
      if (far - near <= tolerance) continue;
      const fromPoint = pointAt(edge, (near + far) / 2), toPoint = pointAt(b[i], (near + far) / 2);
      const rise = toPoint[1] - fromPoint[1];
      if (rise <= options.stepUp + tolerance && -rise <= options.stepDown + tolerance) {
        portals.push({ from: edge.id, to: b[i].id, points: [fromPoint, toPoint] });
      }
      if (-rise <= options.stepUp + tolerance && rise <= options.stepDown + tolerance) {
        portals.push({ from: b[i].id, to: edge.id, points: [toPoint, fromPoint] });
      }
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
