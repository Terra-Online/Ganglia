import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import { installTransferPrototype } from '#@/src/v1/search/candidate-transfers.ts';

installTransferPrototype(createRustTransferQuery);

import { createRustCollisionWorld } from '#@/prototype/rust-kernel/collision-world.ts';
import { installCollisionPrototype } from '#@/src/v1/geo/collision.ts';

if (process.env.GANGLIA_RUST_COLLISION === '1') installCollisionPrototype(createRustCollisionWorld);

import {
  chooseTypeScriptSchedule,
  installSchedulePrototype,
} from '#@/src/v1/resource/locomotion.ts';

if (process.env.GANGLIA_LOCOMOTION_LABELS) {
  const maxLabels = Number(process.env.GANGLIA_LOCOMOTION_LABELS);
  if (!Number.isSafeInteger(maxLabels) || maxLabels < 2 || maxLabels % 2)
    throw new Error('Invalid prototype locomotion label limit');
  installSchedulePrototype((blocks, options) =>
    chooseTypeScriptSchedule(blocks, options, maxLabels),
  );
}

import { createRustScheduleChooser } from '#@/prototype/rust-kernel/locomotion-binding.ts';

if (process.env.GANGLIA_RUST_LOCOMOTION === '1')
  installSchedulePrototype(
    createRustScheduleChooser(Number(process.env.GANGLIA_LOCOMOTION_LABELS ?? 256)),
  );
