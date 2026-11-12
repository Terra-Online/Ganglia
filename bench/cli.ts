import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { loadFileScene } from './adapters/files.ts';
import { runBenchmark } from './run.ts';
import { cases } from './scenes/map02.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    help: { type: 'boolean' },
    'data-root': { type: 'string', default: resolve(root, '.local/data') },
    extractor: { type: 'string', default: resolve(root, '.local/repos/Atlos/talos/.cache/noclip') },
    concurrency: { type: 'string', default: '1' },
    limit: { type: 'string', default: '50' },
  },
});
if (values.help)
  console.log(
    'Usage: pnpm benchmark:full [--json] [--data-root <path>] [--extractor <path>] [--limit <1..50>] [--concurrency <lanes>]',
  );
else {
  try {
    const count = Number(values.limit);
    if (!Number.isInteger(count) || count < 1 || count > cases.length)
      throw new Error('Invalid query limit');
    const concurrency = Number(values.concurrency);
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
      throw new Error('Invalid concurrency');
    const started = performance.now();
    const { prepare, timings, metadata } = await loadFileScene(
      values['data-root'],
      values.extractor,
      concurrency,
    );
    const inputLoadMs = performance.now() - started;
    const selected = cases.slice(0, count);
    const report = await runBenchmark(prepare, selected, (phase) => {
      console.error(JSON.stringify({ phase, queries: selected.length }));
      if (phase === 'batch') {
        const timing = timings[0];
        timing.normalizationMs = timing.candidateMs = timing.localSolveMs = 0;
      }
    });
    const hash = createHash('sha256');
    for (const directory of ['src', 'bench'])
      for (const name of (await readdir(resolve(root, directory), { recursive: true })).sort()) {
        if (name.endsWith('.ts'))
          hash
            .update(`${directory}/${name}\0`)
            .update(await readFile(resolve(root, directory, name)));
      }
    const output = {
      schemaVersion: 2,
      adapter: 'scene-files',
      node: process.version,
      execArgv: process.execArgv,
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim(),
      sourceSha256: hash.digest('hex'),
      ...metadata,
      concurrency,
      cases: selected,
      inputLoadMs,
      timings,
      policy:
        'All dataset file reads, JSON decoding, source verification and hashing finish before preparation. One full unmeasured batch prewarms the same prepared solver and lane-local physical caches. The measured batch recomputes queries without completed-route caching and reads inputs from memory only. It includes normalization, remaining lazy computation, candidate search, target approach, physical windows and retries. Inclusive phase timers describe measured work only and may overlap across lanes. OS scheduling/JIT/GC uncontrolled.',
      ...report,
    };
    if (values.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(
        `${metadata.scene}: ${selected.length} full-scene queries; local files, no Atlos server`,
      );
      console.table(report.batch.results);
      console.log(`Prewarm: ${(report.prewarmMs / 1000).toFixed(2)} s; excluded`);
      console.log(
        `Batch: ${report.batch.queriesPerSecond.toFixed(3)} queries/s; ${report.batch.results.filter((r) => r.sameOutcomeAsPrewarm && r.sameTruncationAsPrewarm).length}/${selected.length} outcomes match prewarm`,
      );
      console.log(output.policy);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
