import {
  BUILTIN_UNITS,
  compareNumberValues,
  formatAmount,
  formatNumberValue,
  isCanonicalNumber,
  nearestValues,
  parseNumberValue,
  resolveUnit,
  type Attribute,
  type Id,
  type InventorySnapshot,
  type NearestHit,
  type Quantity,
  type UnitDef,
} from '@antresol/core'
import { kiloK } from './quick-add'
import { pathOf, snapshotIndex } from './views'

export function unitOf(s: InventorySnapshot, itemId: Id): UnitDef {
  const item = snapshotIndex(s).items.get(itemId)
  return (item && resolveUnit(item.unitKey, s.units)) ?? BUILTIN_UNITS.pcs
}

/** An amount with the unit as a suffix, as list rows write it: "100", "1.5k", "3 m". */
export function suffixed(q: Quantity, unit: UnitDef): string {
  const text = formatAmount(q, unit)
  return unit.key === 'pcs' ? text.replace(/ pcs$/, '') : text
}

/** A word that starts like a number and has something after it ("10K", "4k7", "1%", "0.25W"); a bare number ("600") is
 *  too vague to be a value, and a case code ("104") is no value at all. */
export const VALUE_WORD = /^\p{N}[\p{N}.,]*\s*[^\p{N}\s.,]/u

export interface NearestEntry {
  itemId: Id
  variantId: Id | null
  /** The value as the attribute writes it: "4.3 kΩ". */
  value: string
  /** What is in stock, with the unit as a suffix: "12", "3 m". */
  stock: string
}
export interface NearestSuggestion {
  /** The value asked for, as the attribute writes it: "4.7 kΩ". */
  wanted: string
  below: NearestEntry | null
  above: NearestEntry | null
}

/** Whether a live (not archived, not in an archived folder) item or variant has exactly this value of the attribute. */
function holdsValue(s: InventorySnapshot, attributeId: Id, value: string): boolean {
  const ix = snapshotIndex(s)
  const live = (itemId: Id): boolean => {
    const item = ix.items.get(itemId)
    return !!item && item.archivedAt === null && (item.folderId === null || pathOf(ix, item.folderId).length > 0)
  }
  const same = (v: string | null): boolean => v !== null && isCanonicalNumber(v) && compareNumberValues(v, value) === 0
  for (const a of s.itemAttributes) {
    if (a.attributeId === attributeId && a.axisPosition === null && same(a.value) && live(a.itemId)) return true
  }
  const variants = new Map(s.variants.map((v) => [v.id, v] as const))
  for (const a of s.variantAttributeValues) {
    const v = variants.get(a.variantId)
    if (a.attributeId === attributeId && v && v.archivedAt === null && same(a.value) && live(v.itemId)) return true
  }
  return false
}

/** `word` read as a value of a number attribute that nothing holds, with the nearest smaller and larger values and
 *  their stock; null when the word is no value, something holds it, or the attribute has no other values. */
export function nearestSuggestion(s: InventorySnapshot, word: string): NearestSuggestion | null {
  const w = word.trim()
  if (!VALUE_WORD.test(w)) return null
  const reading = kiloK(w)
  const read = s.attributes.flatMap((a) => {
    if (a.kind !== 'number') return []
    const value = parseNumberValue(reading, a)
    return value === null ? [] : [{ a, value }]
  })
  if (read.some(({ a, value }) => holdsValue(s, a.id, value))) return null
  // Several attributes may read the word ("4.7K" is kΩ and kF): the one whose neighbour is closest by ratio speaks.
  const distance = (h: NearestHit | null, value: string): number =>
    h && Number(h.value) > 0 && Number(value) > 0 ? Math.abs(Math.log10(Number(h.value) / Number(value))) : Infinity
  let best: { a: Attribute; value: string; below: NearestHit | null; above: NearestHit | null; score: number } | null = null
  for (const { a, value } of read) {
    const { below, above } = nearestValues(s, a, value)
    if (!below && !above) continue
    const score = Math.min(distance(below, value), distance(above, value))
    if (!best || score < best.score) best = { a, value, below, above, score }
  }
  if (!best) return null
  const { a, value, below, above } = best
  const entry = (h: NearestHit | null): NearestEntry | null =>
    h && {
      itemId: h.itemId,
      variantId: h.variantId,
      value: formatNumberValue(h.value, a),
      stock: suffixed(h.quantity, unitOf(s, h.itemId)),
    }
  return { wanted: formatNumberValue(value, a), below: entry(below), above: entry(above) }
}
