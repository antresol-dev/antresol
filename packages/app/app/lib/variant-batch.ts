import { duplicateOf, formatAttributeValue, itemAxes, sameAxisValue, type Id, type InventorySnapshot } from '@graymatter/core'
import { parseAttributeInput } from './attribute-values'
import { splitValueList, splitVariantLines } from './lists'

export interface BatchLine {
  raw: string
  /** The parsed value on every axis, in axis order; null when the line has an error. */
  values: { attributeId: Id; value: string }[] | null
  /** The variant's label as it will read (`4.7 kΩ · 50 V`); null when the line has an error. */
  label: string | null
  /** An i18n key. */
  error: string | null
  /** An existing variant of the item (archived ones included) with these values. */
  duplicate: { variantId: Id; archived: boolean; archiveId: Id | null } | null
  /** The same values appear on an earlier line of the list. */
  repeat: boolean
}

const SEPARATOR = ' · '

/**
 * Reads what was typed into "Add variants" against the item's axes. One axis: values separated like a list; two or
 * more: a variant per line, values separated by `;` in axis order. Nothing here writes; the caller creates the lines
 * that have no error, no duplicate and are not a repeat.
 */
export function planVariantBatch(s: InventorySnapshot, itemId: Id, input: string): BatchLine[] {
  const axes = itemAxes(s, itemId)
  if (axes.length === 0) return []
  const rows =
    axes.length === 1
      ? splitValueList(input, axes[0]!.kind).map((value) => [value])
      : splitVariantLines(input)
  const accepted: Map<Id, string>[] = []
  return rows.map((row): BatchLine => {
    const raw = row.join('; ')
    const fail = (error: string): BatchLine => ({ raw, values: null, label: null, error, duplicate: null, repeat: false })
    if (row.length !== axes.length || row.some((part) => part === '')) return fail('errors.domain.axis_value_required')
    const values: { attributeId: Id; value: string }[] = []
    for (const [n, axis] of axes.entries()) {
      const parsed = parseAttributeInput(axis, row[n]!)
      if ('error' in parsed) return fail(`errors.domain.${parsed.error}`)
      values.push({ attributeId: axis.id, value: parsed.value })
    }
    const byAxis = new Map(values.map((v) => [v.attributeId, v.value] as const))
    const repeat = accepted.some((earlier) => axes.every((a) => sameAxisValue(a, earlier.get(a.id) ?? null, byAxis.get(a.id) ?? null)))
    accepted.push(byAxis)
    const existing = duplicateOf(s, itemId, byAxis)
    return {
      raw,
      values,
      label: axes.map((a) => formatAttributeValue(a, byAxis.get(a.id)!)).join(SEPARATOR),
      error: null,
      duplicate: existing ? { variantId: existing.id, archived: existing.archivedAt !== null, archiveId: existing.archiveId } : null,
      repeat,
    }
  })
}

/** Whether a line is created: valid, not an existing variant, not a repeat. */
export const isNewLine = (l: BatchLine): boolean => l.error === null && l.duplicate === null && !l.repeat
