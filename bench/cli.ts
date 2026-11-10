import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { prepareSurfaceActionSolver } from '@opendfieldmap/ganglia/solver';

import { runBenchmark } from './run.js';
import { loadMap02, cases } from './scenes/map02.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
    'data-root': { type: 'string', default: resolve(root, '.local/data') },
  },
});
if (values.help) {
  console.log('Usage: pnpm benchmark [--json] [--data-root <directory>]');
  console.log(
    `Runs ${cases.length} fixed map02 queries individually, then as one same-scene batch.`,
  );
} else {
  try {
    const { input, metadata } = await loadMap02(values['data-root']);
    // Include actual source bytes, since a commit alone cannot identify a dirty tree.
    const sourceHash = createHash('sha256');
    for (const dir of ['src', 'bench']) {
      for (const name of (await readdir(resolve(root, dir), { recursive: true })).sort()) {
        if (!name.endsWith('.ts')) continue;
        sourceHash.update(`${dir}/${name}\0`).update(await readFile(resolve(root, dir, name)));
      }
    }
    const artifactHash = createHash('sha256');
    for (const name of (await readdir(resolve(root, 'dist'), { recursive: true })).sort()) {
      if (name.endsWith('.js'))
        artifactHash.update(name).update(await readFile(resolve(root, 'dist', name)));
    }
    const preparationMs: number[] = [];
    const report = await runBenchmark(async () => {
      const started = performance.now();
      const solver = await prepareSurfaceActionSolver(input);
      preparationMs.push(performance.now() - started);
      return solver;
    }, cases);
    const output = {
      schemaVersion: 1,
      adapter: 'surface-action',
      execution: 'serial',
      node: process.version,
      execArgv: process.execArgv,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256: sourceHash.digest('hex'),
      artifactSha256: artifactHash.digest('hex'),
      ...metadata,
      cases,
      policy:
        'Input I/O and preparation excluded. Single queries first, batch on a separate prepared solver in the same process. No explicit warmup; lazy discovery preparation is charged to its first query. No completed-route cache. OS pages/JIT/GC uncontrolled.',
      preparationMs,
      ...report,
    };
    if (values.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(
        `${metadata.scene}: ${cases.length} queries; surface-action adapter (serial batch)`,
      );
      console.log(
        `Preparation (single / batch): ${preparationMs.map((ms) => ms.toFixed(1)).join(' / ')} ms; excluded`,
      );
      console.table(
        report.single.results.map((r) => ({
          query: r.id,
          ms: +r.wallMs.toFixed(2),
          status: r.status,
          cost: r.cost,
          jumps: r.jumps,
          drops: r.drops,
          truncated: r.truncated,
        })),
      );
      console.log(
        `Single: total ${report.single.totalWallMs.toFixed(2)} ms, median ${report.single.medianMs?.toFixed(2) ?? 'n/a'} ms, P95 ${report.single.p95Ms?.toFixed(2) ?? 'n/a'} ms`,
      );
      console.log(
        `Batch: ${report.batch.wallMs.toFixed(2)} ms, ${report.batch.queriesPerSecond.toFixed(2)} queries/s`,
      );
      console.log(
        `Same outcomes: ${report.batch.results.filter((r) => r.sameOutcomeAsSingle && r.sameTruncationAsSingle).length}/${cases.length}`,
      );
      console.log(output.policy);
    }
  } catch (error) {
    console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error('Use --data-root to select the directory containing the scene exports.');
    process.exitCode = 1;
  }
}
