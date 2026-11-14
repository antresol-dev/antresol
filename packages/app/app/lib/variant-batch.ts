import { BUILTIN_UNITS, duplicateOf, formatAmountParts, formatAttributeValue, itemAxes, keepValuesTogether, resolveUnit, sameAxisValue, type Id, type InventorySnapshot, type Quantity, type UnitDef } from '@antresol/core'
import { parseAmountText } from './amounts'
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
  /** The stock typed after the values, in the item's unit; null when the line has none. */
  quantity: Quantity | null
  /** The quantity as it will read (`10 pcs`); null without a quantity. */
  quantityLabel: string | null
}

const SEPARATOR = ' · '

/** `formatAmount`, but pieces keep their unit past a thousand (`10k pcs`): a bare "10k" next to a value reads as another value. */
function quantityText(q: Quantity, unit: UnitDef): string {
  const { number, unit: symbol } = formatAmountParts(q, unit)
  return unit.key === 'pcs' && symbol !== unit.symbol ? `${number}${symbol} ${unit.symbol}` : `${number} ${symbol}`
}

/**
 * Reads what was typed into "Add variants" against the item's axes. A variant per line, its values separated by `;` in
 * axis order, then an optional quantity (`100n; 50V; 10`, or `1k; 100` on one axis). One axis and no `;` on the line:
 * a list separated like any list (`1k, 10k`), without quantities. Nothing here writes; the caller creates the lines that
 * have no error, no duplicate and are not a repeat.
 */
export function planVariantBatch(s: InventorySnapshot, itemId: Id, input: string): BatchLine[] {
  const axes = itemAxes(s, itemId)
  if (axes.length === 0) return []
  const unit = resolveUnit(s.items.find((i) => i.id === itemId)?.unitKey ?? 'pcs', s.units) ?? BUILTIN_UNITS.pcs
  const rows =
    axes.length === 1
      ? input.split(/\r?\n/).flatMap((line) => (line.includes(';') ? splitVariantLines(line) : splitValueList(line, axes[0]!.kind).map((value) => [value])))
      : splitVariantLines(input)
  const accepted: Map<Id, string>[] = []
  return rows.map((all): BatchLine => {
    const raw = all.join('; ')
    const fail = (error: string): BatchLine => ({ raw, values: null, label: null, error, duplicate: null, repeat: false, quantity: null, quantityLabel: null })
    const row = all.slice(0, axes.length)
    const tail = all.slice(axes.length)
    if (row.length !== axes.length || row.some((part) => part === '')) return fail('errors.domain.axis_value_required')
    if (tail.length > 1) return fail('errors.domain.variant_line_too_long')
    let quantity: Quantity | null = null
    if (tail.length === 1) {
      quantity = parseAmountText(tail[0]!, unit)
      if (quantity === null || /^0*\.?0*$/.test(quantity)) return fail('errors.domain.invalid_quantity')
    }
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
      label: axes.map((a) => keepValuesTogether(formatAttributeValue(a, byAxis.get(a.id)!))).join(SEPARATOR),
      error: null,
      duplicate: existing ? { variantId: existing.id, archived: existing.archivedAt !== null, archiveId: existing.archiveId } : null,
      repeat,
      quantity,
      quantityLabel: quantity === null ? null : quantityText(quantity, unit),
    }
  })
}

/** Whether a line is created: valid, not an existing variant, not a repeat. */
export const isNewLine = (l: BatchLine): boolean => l.error === null && l.duplicate === null && !l.repeat
