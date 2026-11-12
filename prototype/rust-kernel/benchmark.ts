import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { benchmarkMarkdown, type MarkdownReport } from '#@/bench/markdown.ts';

// Isolate game-adapter dependency resolution from Atlos's packaged kernel.
// Both runs use the same copied adapter and the same live Ganglia source.
const root = fileURLToPath(new URL('../../', import.meta.url));
const original = resolve(root, '.local/repos/Atlos/talos/.cache/noclip');
const adapter = resolve(root, '.local/research/rust-transfers/adapter');
for (const name of ['extractor', 'formats']) {
  const source = resolve(original, 'packages', name),
    target = resolve(adapter, 'packages', name);
  await mkdir(target, { recursive: true });
  await cp(resolve(source, 'src'), resolve(target, 'src'), { recursive: true });
  await cp(resolve(source, 'package.json'), resolve(target, 'package.json'));
  const link = async (from: string, to: string) => {
    await mkdir(resolve(to, '..'), { recursive: true });
    await rm(to, { recursive: true, force: true });
    await symlink(from, to, 'dir');
  };
  for (const entry of await readdir(resolve(source, 'node_modules'), { withFileTypes: true })) {
    const names = entry.name.startsWith('@')
      ? (await readdir(resolve(source, 'node_modules', entry.name))).map(
          (n) => `${entry.name}/${n}`,
        )
      : [entry.name];
    for (const dependency of names) {
      const from =
        dependency === '@opendfieldmap/ganglia'
          ? root
          : dependency === '@endfield-noclip/formats'
            ? resolve(adapter, 'packages/formats')
            : await realpath(resolve(source, 'node_modules', dependency));
      await link(from, resolve(target, 'node_modules', dependency));
    }
  }
}
const args = process.argv.slice(2);
const native = !args.includes('--typescript');
const workerOption = args.indexOf('--workers');
if (process.env.GANGLIA_PROFILE && workerOption >= 0 && args[workerOption + 1] !== '1')
  throw new Error('Profile only the inline solver with --workers 1');
const command = [
  '--max-old-space-size=6144',
  ...(native ? ['--import', resolve(root, 'prototype/rust-kernel/register.ts')] : []),
  ...(process.env.GANGLIA_PROFILE
    ? ['--import', resolve(root, 'prototype/rust-kernel/profile.ts')]
    : []),
  resolve(root, 'bench/cli.ts'),
  '--extractor',
  adapter,
  ...args.filter((arg) => arg !== '--typescript' && arg !== '--markdown'),
  ...(args.includes('--markdown') && !args.includes('--json') ? ['--json'] : []),
];
const run = spawnSync(process.execPath, command, {
  cwd: root,
  stdio: ['inherit', 'pipe', 'inherit'],
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
});
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);
if (args.includes('--json') || args.includes('--markdown')) {
  const hash = createHash('sha256');
  for (const name of [
    'Cargo.toml',
    'Cargo.lock',
    'src/lib.rs',
    'src/collision.rs',
    'binding.ts',
    'register.ts',
    'collision-world.ts',
    'collision-binding.ts',
  ])
    hash.update(name + '\0').update(await readFile(resolve(root, 'prototype/rust-kernel', name)));
  const report: MarkdownReport = JSON.parse(run.stdout);
  report.prototype = {
    implementation: native
      ? process.env.GANGLIA_RUST_COLLISION === '1'
        ? 'rust-transfers-and-collision'
        : 'rust-transfers'
      : 'typescript',
    sourceSha256: hash.digest('hex'),
    ...(native
      ? {
          binarySha256: createHash('sha256')
            .update(await readFile(resolve(root, '.local/cache/rust-transfers/transfer.node')))
            .digest('hex'),
        }
      : {}),
  };
  console.log(
    args.includes('--markdown') ? benchmarkMarkdown(report) : JSON.stringify(report, null, 2),
  );
} else process.stdout.write(run.stdout);
