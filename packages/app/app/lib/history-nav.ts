import type { InventoryRef } from './types'

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Vue Router keeps `back` and `forward` (string or null) in history.state. */
export function navAvailability(historyState: unknown): { canBack: boolean; canForward: boolean } {
  if (!isObject(historyState)) return { canBack: false, canForward: false }
  return { canBack: typeof historyState.back === 'string', canForward: typeof historyState.forward === 'string' }
}

/** Key of the inventory a history entry was opened in, next to Vue Router's own keys in history.state. */
export const INVENTORY_KEY = 'gmInventory'

export function entryInventory(historyState: unknown): InventoryRef | null {
  if (!isObject(historyState)) return null
  const ref = historyState[INVENTORY_KEY]
  if (!isObject(ref) || typeof ref.sourceId !== 'string' || typeof ref.inventoryId !== 'string') return null
  return { sourceId: ref.sourceId, inventoryId: ref.inventoryId }
}

export type EntrySync = { kind: 'stamp' } | { kind: 'none' } | { kind: 'switch'; ref: InventoryRef } | { kind: 'root' }

const sameRef = (a: InventoryRef, b: InventoryRef): boolean =>
  a.sourceId === b.sourceId && a.inventoryId === b.inventoryId

/** After a navigation lands on a history entry:
 *  - not stamped yet → stamp it with the current inventory (nothing to stamp without one);
 *  - stamped with the current inventory → nothing;
 *  - stamped with another inventory that is still active (in `known`) → switch to it;
 *  - stamped with an inventory that is gone → open the current inventory's root. */
export function entrySync(entry: InventoryRef | null, current: InventoryRef | null, known: InventoryRef[]): EntrySync {
  if (!entry) return current ? { kind: 'stamp' } : { kind: 'none' }
  if (current && sameRef(entry, current)) return { kind: 'none' }
  const target = known.find((k) => sameRef(k, entry))
  if (target) return { kind: 'switch', ref: { sourceId: target.sourceId, inventoryId: target.inventoryId } }
  return { kind: 'root' }
}
