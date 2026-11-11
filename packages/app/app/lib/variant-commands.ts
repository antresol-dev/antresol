import { duplicatesAfter, type Command, type Id, type InventorySnapshot, type Variant } from '@graymatter/core'

export interface ValuesRow {
  variantId: Id
  /** Only the cells that changed, by attribute id; null erases. */
  values: Record<Id, string | null>
}

/** One `variant.setValues` for every row that changed something; null when none did. */
export function setValuesCommand(itemId: Id, rows: readonly ValuesRow[]): Extract<Command, { type: 'variant.setValues' }> | null {
  const changed = rows.filter((r) => Object.keys(r.values).length > 0)
  if (changed.length === 0) return null
  return {
    type: 'variant.setValues',
    itemId,
    rows: changed.map((r) => ({
      variantId: r.variantId,
      values: Object.entries(r.values).map(([attributeId, value]) => ({ attributeId, value })),
    })),
  }
}

export interface RowClash {
  variantId: Id
  /** The variant these values would equal; an archived one can be restored instead (`archiveId`). */
  archived: boolean
  archiveId: Id | null
  other: Variant
}

/** The rows whose values, with every row applied at once, equal another variant's (archived ones too). */
export function rowClashes(s: InventorySnapshot, itemId: Id, rows: readonly ValuesRow[]): RowClash[] {
  const command = setValuesCommand(itemId, rows)
  if (!command) return []
  return duplicatesAfter(s, itemId, command.rows).map((d) => ({
    variantId: d.variantId,
    archived: d.duplicate.archivedAt !== null,
    archiveId: d.duplicate.archiveId,
    other: d.duplicate,
  }))
}
