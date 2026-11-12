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
    'Usage: pnpm benchmark:scene [--json] [--data-root <path>] [--extractor <path>] [--limit <1..50>] [--concurrency <lanes>]',
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
    const report = await runBenchmark(prepare, selected, (completed, id, wallMs) => {
      console.error(
        JSON.stringify({ phase: 'single', completed, total: selected.length, id, wallMs }),
      );
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
      schemaVersion: 1,
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
        'No frontend, HTTP, resource generation or completed-route cache. Immutable file snapshot and candidate preparation excluded. Timed queries include lazy resource decoding, local preparation, candidate search, target approach, window validation and retries. Local solve time includes lazy preparation. Single and batch use independent preparation/cache owners. Batch concurrency is explicit; each execution lane owns its preparation cache. Resource and local-solve timers sum inclusive work across lanes and may overlap. OS pages/JIT/GC uncontrolled.',
      ...report,
    };
    if (values.json) console.log(JSON.stringify(output, null, 2));
    else {
      console.log(
        `${metadata.scene}: ${selected.length} full-scene queries; local files, no Atlos server`,
      );
      console.table(report.single.results);
      console.log(
        `Batch: ${report.batch.queriesPerSecond.toFixed(3)} queries/s; ${report.batch.results.filter((r) => r.sameOutcomeAsSingle && r.sameTruncationAsSingle).length}/${selected.length} identical outcomes`,
      );
      console.log(output.policy);
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
