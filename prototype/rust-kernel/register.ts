import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import { installTransferPrototype } from '#@/src/v1/search/candidate-transfers.ts';

installTransferPrototype(createRustTransferQuery);

import { createRustCollisionWorld } from '#@/prototype/rust-kernel/collision-world.ts';
import { installCollisionPrototype } from '#@/src/v1/geo/collision.ts';

if (process.env.GANGLIA_RUST_COLLISION === '1') installCollisionPrototype(createRustCollisionWorld);
