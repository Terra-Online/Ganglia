import { execFileSync } from 'node:child_process';
import { copyFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = `${root}.local/cache/rust-transfers`;
execFileSync(
  'cargo',
  ['build', '--release', '--locked', '--manifest-path', 'prototype/rust-kernel/Cargo.toml'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CARGO_TARGET_DIR: target },
  },
);
const library =
  process.platform === 'darwin'
    ? 'libganglia_transfer_prototype.dylib'
    : process.platform === 'win32'
      ? 'ganglia_transfer_prototype.dll'
      : 'libganglia_transfer_prototype.so';
// Renaming preserves any library inode already mapped by another Node isolate.
const staged = `${target}/transfer-${process.pid}.node`;
copyFileSync(`${target}/release/${library}`, staged);
renameSync(staged, `${target}/transfer.node`);
