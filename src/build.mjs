import { init, getNavMeshPositionsAndIndices } from '@recast-navigation/core';
import { generateSoloNavMesh } from '@recast-navigation/generators';

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
  const { positions, indices } = geometry;
  const { profile, maxSlope, stepUp, stepDown, cellSize, cellHeight } = options;
  if (!positions || !indices || positions.length < 9 || positions.length % 3 ||
      indices.length < 3 || indices.length % 3) throw new Error('Invalid collision geometry');
  for (const v of positions) if (!Number.isFinite(v)) throw new Error('Non-finite collision vertex');
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= positions.length / 3) throw new Error('Invalid collision index');
  }
  if (!profile || ![profile.radius, profile.height, cellSize, cellHeight].every(v => Number.isFinite(v) && v > 0) ||
      profile.height < 2 * profile.radius || !Number.isFinite(maxSlope) || maxSlope <= 0 || maxSlope >= 90 ||
      ![stepUp, stepDown].every(v => Number.isFinite(v) && v >= 0)) throw new Error('Invalid ground build profile');
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
    if (!b || !Array.isArray(b.min) || !Array.isArray(b.max) || b.min.length !== 2 || b.max.length !== 2 ||
        ![...b.min, ...b.max].every(Number.isFinite) || b.min.some((v, i) => v >= b.max[i])) {
      throw new Error('Invalid ground build bounds');
    }
    min[0] = b.min[0]; min[2] = b.min[1];
    max[0] = b.max[0]; max[2] = b.max[1];
  }
  const width = Math.ceil((max[0] - min[0]) / cellSize);
  const depth = Math.ceil((max[2] - min[2]) / cellSize);
  if (width < 1 || depth < 1 || width * depth > 8_000_000 || (max[1] - min[1]) / cellHeight > 8190) {
    throw new Error('Collision region exceeds ground build voxel limits; partition the input');
  }
  const height = Math.ceil(profile.height / cellHeight), radius = Math.ceil(profile.radius / cellSize);
  const climb = Math.max(0, Math.floor(Math.min(stepUp, stepDown) / cellHeight) - 1);
  if (height < 3 || height > 255 || radius > 255 || climb > 255) throw new Error('Unsupported ground build voxel profile');
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
  });
  if (!result.success) {
    const details = result.intermediates.buildContext.logs.map(entry => entry.msg).join('; ');
    throw new Error('Ground build failed: ' + result.error + (details ? ' (' + details + ')' : ''));
  }
  try {
    const [points, triangles] = getNavMeshPositionsAndIndices(result.navMesh);
    const surfaces = [];
    for (let i = 0; i < triangles.length; i += 3) {
      surfaces.push({ id: String(i / 3), vertices: triangles.slice(i, i + 3).map(j => points.slice(j * 3, j * 3 + 3)) });
    }
    return surfaces;
  } finally {
    result.navMesh.destroy();
  }
}
