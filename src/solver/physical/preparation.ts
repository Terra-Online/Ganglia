import type { PhysicalCache } from '#@/src/solver/physical/solve.ts';
/** One cache slot holds values produced by the same physical preparation site.
 * Slot/key changes invalidate dependants before a different preparation is stored. */
export function createPhysicalCache() {
  const slots = new Map<string, { key: string; value: unknown }>();
  return {
    clear() {
      slots.clear();
    },
    release(slot: 'ground' | 'moving') {
      slots.delete(slot);
    },
    async memo<T>(slot: string, key: string, create: () => T | Promise<T>) {
      const found = slots.get(slot);
      if (found?.key === key) return { value: found.value as T, reused: true };
      slots.delete(slot);
      if (slot === 'ground')
        for (const dependent of ['devices', 'moving', 'refinement']) slots.delete(dependent);
      if (slot === 'moving') slots.delete('refinement');
      const value = await create();
      slots.set(slot, { key, value });
      return { value, reused: false };
    },
  } satisfies PhysicalCache & { clear(): void };
}
