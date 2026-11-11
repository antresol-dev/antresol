import { cmpQ, newId, type Command, type Id, type InventorySnapshot, type Quantity, type UnitDef } from '@graymatter/core'
import { parseAmountText } from './amounts'
import { itemView } from './item-view'
import { folderView } from './views'
import { bucketKey } from './workspace'

/** One stock bucket of an item of the folder, as "Count this folder" lists it (spec 4.14). */
export interface CountRow {
  /** bucketKey(itemId, variantId). */
  key: string
  itemId: Id
  variantId: Id | null
  itemName: string
  /** The variant's label; null for the stock kept without a variant. */
  variantName: string | null
  hasVariants: boolean
  /** The first row of its item: it carries the item's name. */
  first: boolean
  /** The stock now. */
  quantity: Quantity
  /** `quantity` as shown, with its unit and prefix. */
  number: string
  unit: string
  /** What an entry is read in. */
  unitDef: UnitDef
}

/** The buckets of the folder's own items (no subfolders), items by name, buckets as the item screen lists them; null
 *  when the folder is missing or archived. */
export function countRows(s: InventorySnapshot, folderId: Id): CountRow[] | null {
  const folder = folderView(s, folderId)
  if (!folder?.folder) return null
  const rows: CountRow[] = []
  for (const { id } of folder.items) {
    const view = itemView(s, id)
    if (!view) continue
    view.buckets.forEach((b, i) =>
      rows.push({
        key: bucketKey(id, b.variantId),
        itemId: id,
        variantId: b.variantId,
        itemName: view.item.name,
        variantName: b.name,
        hasVariants: view.hasVariants,
        first: i === 0,
        quantity: b.quantity,
        number: b.number,
        unit: b.unit,
        unitDef: view.unit,
      }),
    )
  }
  return rows
}

/** A row whose entry differs from its stock; `target` is null when the entry is not a valid amount. */
export interface CountChange {
  row: CountRow
  target: Quantity | null
}

/** The rows whose entry (by row key) is not the stock they show, in row order. Rows without an entry are unchanged. */
export function countChanges(rows: CountRow[], entries: ReadonlyMap<string, string>): CountChange[] {
  const changes: CountChange[] = []
  for (const row of rows) {
    const text = entries.get(row.key)
    if (text === undefined) continue
    const target = parseAmountText(text, row.unitDef)
    if (target === null || cmpQ(target, row.quantity) !== 0) changes.push({ row, target })
  }
  return changes
}

/** A row's entry was edited: its next write gets a fresh movementId. A first write that committed but timed out would
 *  otherwise make the server drop the corrected value as a repeat of the same id while "Saved" shows (stock.set is an
 *  absolute target, so a new id is always safe). */
export function renewCountId(ids: Map<string, Id>, key: string): void {
  ids.delete(key)
}

/**
 * One stock.set per change, one after another (no batch command yet). Each row's movementId lives in `ids` (by row key)
 * until its write lands, so a retry after a failure sends the same command and a write that did land is not repeated.
 * Stops at the first failure: what landed stays. `onProgress(done)` after each landed write.
 */
export async function applyCounts(
  changes: { row: CountRow; target: Quantity }[],
  ids: Map<string, Id>,
  apply: (command: Command) => Promise<void>,
  onProgress?: (done: number) => void,
): Promise<{ done: number; failed: { key: string; error: unknown } | null }> {
  let done = 0
  for (const { row, target } of changes) {
    let movementId = ids.get(row.key)
    if (!movementId) {
      movementId = newId()
      ids.set(row.key, movementId)
    }
    try {
      await apply({ type: 'stock.set', movementId, itemId: row.itemId, variantId: row.variantId, target, note: null })
    } catch (error) {
      return { done, failed: { key: row.key, error } }
    }
    ids.delete(row.key)
    done++
    onProgress?.(done)
  }
  return { done, failed: null }
}
