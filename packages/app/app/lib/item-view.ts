import {
  addQ,
  BUILTIN_UNITS,
  cmpQ,
  formatAmountParts,
  negQ,
  resolveUnit,
  unitPrice,
  type Attribute,
  type Command,
  type Folder,
  type Id,
  type InventorySnapshot,
  type Item,
  type Movement,
  type Photo,
  type MovementKind,
  type Quantity,
  type StockLine,
  type UnitDef,
} from '@graymatter/core'
import { byName, pathOf, snapshotIndex, type Crumb } from './views'

export interface BucketRow {
  variantId: Id | null
  /** null for the stock kept without a variant. */
  name: string | null
  description: string | null
  quantity: Quantity
  number: string
  unit: string
  outOfStock: boolean
  avgUnitPrice: number | null
  lastUnitPrice: number | null
  /** The variant's photo (one at most); null for the no-variant bucket. */
  photo: Photo | null
  /** Per-variant attribute values (only attributes marked per-variant), by attribute name. */
  values: { attributeId: Id; name: string; value: string | null }[]
}
export interface AttributeRow {
  attributeId: Id
  name: string
  kind: 'text' | 'enum'
  options: string[]
  value: string | null
  /** The item's value is empty and the item has active variants: values live on the variants. */
  perVariant: boolean
}
export interface ItemView {
  item: Item
  crumbs: Crumb[]
  unit: UnitDef
  currency: string
  tags: { id: Id; name: string }[]
  total: { quantity: Quantity; number: string; unit: string; outOfStock: boolean; avgUnitPrice: number | null; lastUnitPrice: number | null }
  /** The no-variant bucket first when shown, then active variants by position. */
  buckets: BucketRow[]
  hasVariants: boolean
  attributes: AttributeRow[]
  /** The item's own photos (variantId null) by position; the first is the cover. */
  photos: Photo[]
}

interface Summary {
  quantity: Quantity
  avgUnitPrice: number | null
  lastUnitPrice: number | null
}

/** The sums of core's itemStock (and, for one line, bucketStock) over the given stock lines. */
function summarize(lines: StockLine[]): Summary {
  let quantity: Quantity = '0'
  let pricedQuantity: Quantity = '0'
  let pricedTotal = 0
  let last: StockLine['lastPriced'] = null
  for (const l of lines) {
    quantity = addQ(quantity, l.quantity)
    pricedQuantity = addQ(pricedQuantity, l.pricedQuantity)
    pricedTotal += l.pricedTotal
    if (l.lastPriced && (!last || l.lastPriced.at > last.at)) last = l.lastPriced
  }
  return {
    quantity,
    avgUnitPrice: cmpQ(pricedQuantity, '0') > 0 ? unitPrice(pricedTotal, pricedQuantity) : null,
    lastUnitPrice: last ? unitPrice(last.totalPrice, last.quantity) : null,
  }
}

const unitOf = (s: InventorySnapshot, item: Item | undefined): UnitDef =>
  (item && resolveUnit(item.unitKey, s.units)) ?? BUILTIN_UNITS.pcs

/** An empty or blank value counts as no value. */
const valueOf = (v: string | null): string | null => (v === null || v.trim() === '' ? null : v)

/** Inventory attributes not yet attached to the item, by name. */
export function attributeChoices(s: InventorySnapshot, itemId: Id): Attribute[] {
  const attached = new Set(s.itemAttributes.filter((a) => a.itemId === itemId).map((a) => a.attributeId))
  return s.attributes.filter((a) => !attached.has(a.id)).sort(byName)
}

/** What to store for an attribute of an item: one value for the item, or one value per variant (a variant left out keeps its value). */
export type AttributeInput = { shared: string } | { variants: Record<Id, string> }

/**
 * The commands that store the input, in order. Per variant: the item's own value is emptied, then only the variants whose
 * value changed are written. Shared: the item's value is set, then every active variant that still has a value of its own
 * is cleared (search indexes them even while the item's value hides them). Blank text counts as no value.
 */
export function attributeWrites(s: InventorySnapshot, itemId: Id, attributeId: Id, input: AttributeInput): Command[] {
  const variants = s.variants.filter((v) => v.itemId === itemId && v.archivedAt === null)
  const current = (variantId: Id): string | null =>
    valueOf(s.variantAttributeValues.find((x) => x.variantId === variantId && x.attributeId === attributeId)?.value ?? null)
  const set = (variantId: Id, value: string | null): Command => ({ type: 'variant.setAttribute', variantId, attributeId, value })
  if ('shared' in input) {
    const value = input.shared.trim() === '' ? null : input.shared.trim()
    return [
      { type: 'item.setAttribute', itemId, attributeId, value },
      ...variants.filter((v) => current(v.id) !== null).map((v) => set(v.id, null)),
    ]
  }
  const writes: Command[] = [{ type: 'item.setAttribute', itemId, attributeId, value: null }]
  for (const v of variants) {
    const text = input.variants[v.id]
    if (text === undefined) continue
    const next = text.trim() === '' ? null : text.trim()
    if (next !== current(v.id)) writes.push(set(v.id, next))
  }
  return writes
}

/** null when the item is missing, archived, or its folder chain is archived or missing. */
export function itemView(s: InventorySnapshot, itemId: Id): ItemView | null {
  const ix = snapshotIndex(s)
  const item = ix.items.get(itemId)
  if (!item || item.archivedAt !== null) return null
  let path: Folder[] = []
  if (item.folderId !== null) {
    path = pathOf(ix, item.folderId)
    if (path.length === 0) return null
  }
  const unit = unitOf(s, item)

  const variants = s.variants
    .filter((v) => v.itemId === itemId && v.archivedAt === null)
    .sort((a, b) => a.position - b.position || byName(a, b))
  const hasVariants = variants.length > 0

  const definitions = new Map(s.attributes.map((a) => [a.id, a] as const))
  const attributes: AttributeRow[] = s.itemAttributes
    .filter((a) => a.itemId === itemId)
    .flatMap((a) => {
      const def = definitions.get(a.attributeId)
      if (!def) return []
      const value = valueOf(a.value)
      return [{ attributeId: def.id, name: def.name, kind: def.kind, options: def.options, value, perVariant: value === null && hasVariants }]
    })
    .sort(byName)
  const perVariant = attributes.filter((a) => a.perVariant)

  const valueKey = (variantId: Id, attributeId: Id): string => `${variantId}\u0000${attributeId}`
  const variantValues = new Map<string, string | null>()
  if (perVariant.length > 0) {
    const ids = new Set(variants.map((v) => v.id))
    for (const v of s.variantAttributeValues) if (ids.has(v.variantId)) variantValues.set(valueKey(v.variantId, v.attributeId), valueOf(v.value))
  }

  const lines = ix.stockByItem.get(itemId) ?? []
  const lineOf = new Map(lines.map((l) => [l.variantId, l] as const))
  const photoOf = new Map<Id, Photo>()
  for (const p of s.photos) {
    if (p.itemId !== itemId || p.variantId === null) continue
    const known = photoOf.get(p.variantId)
    if (!known || p.position < known.position) photoOf.set(p.variantId, p)
  }
  const bucket = (variantId: Id | null, name: string | null, description: string | null, values: BucketRow['values']): BucketRow => {
    const line = lineOf.get(variantId)
    const sum = summarize(line ? [line] : [])
    return {
      variantId,
      name,
      description,
      quantity: sum.quantity,
      ...formatAmountParts(sum.quantity, unit),
      outOfStock: cmpQ(sum.quantity, '0') <= 0,
      avgUnitPrice: sum.avgUnitPrice,
      lastUnitPrice: sum.lastUnitPrice,
      photo: variantId === null ? null : (photoOf.get(variantId) ?? null),
      values,
    }
  }
  const buckets: BucketRow[] = []
  if (!hasVariants || cmpQ(lineOf.get(null)?.quantity ?? '0', '0') !== 0) buckets.push(bucket(null, null, null, []))
  for (const v of variants) {
    const values = perVariant.map((a) => ({
      attributeId: a.attributeId,
      name: a.name,
      value: variantValues.get(valueKey(v.id, a.attributeId)) ?? null,
    }))
    buckets.push(bucket(v.id, v.name, v.description, values))
  }

  // Same rule as core's itemStock: every bucket except archived variants.
  const total = summarize(lines.filter((l) => l.variantId === null || !ix.variants.get(l.variantId)?.archived))

  const tagsById = new Map(s.tags.map((t) => [t.id, t] as const))
  const tags = item.tagIds
    .flatMap((id) => {
      const tag = tagsById.get(id)
      return tag ? [{ id: tag.id, name: tag.name }] : []
    })
    .sort(byName)

  return {
    item,
    crumbs: path.map((f) => ({ id: f.id, name: f.name })),
    unit,
    currency: s.inventory.currency,
    tags,
    total: {
      quantity: total.quantity,
      ...formatAmountParts(total.quantity, unit),
      outOfStock: cmpQ(total.quantity, '0') <= 0,
      avgUnitPrice: total.avgUnitPrice,
      lastUnitPrice: total.lastUnitPrice,
    },
    buckets,
    hasVariants,
    attributes,
    photos: s.photos.filter((p) => p.itemId === itemId && p.variantId === null).sort((a, b) => a.position - b.position),
  }
}

/** Stock without a variant to offer moving into a first variant: only when the item has no active variants and that stock is > 0. */
export function looseTransferOffer(s: InventorySnapshot, itemId: Id): { quantity: Quantity; number: string; unit: string } | null {
  const item = s.items.find((i) => i.id === itemId)
  if (!item) return null
  if (s.variants.some((v) => v.itemId === itemId && v.archivedAt === null)) return null
  const line = snapshotIndex(s).stockByItem.get(itemId)?.find((l) => l.variantId === null)
  if (!line || cmpQ(line.quantity, '0') <= 0) return null
  return { quantity: line.quantity, ...formatAmountParts(line.quantity, unitOf(s, item)) }
}

export interface JournalRow {
  /** Movement id; for a transfer, its transferId. */
  id: Id
  kind: MovementKind
  at: string
  by: string
  /** '+37', '−5' (U+2212); transfers show the moved amount without a sign. */
  number: string
  unit: string
  /** Variant name; null = no variant. Unused for transfers. */
  variantName: string | null
  transfer: { from: string | null; to: string | null } | null
  totalPrice: number | null
  /** As stored; show it as text only. */
  sourceUrl: string | null
  /** `sourceUrl` as a link target, only when it parses as an http(s) URL; null otherwise (never link it). */
  sourceHref: string | null
  note: string | null
}

/** Core refuses other schemes on write, but a source can be written by other clients: check again before linking. */
function httpHref(url: string | null): string | null {
  if (url === null) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}

const MINUS = '−'

/** `movements` newest first (as loadMovements returns them); the two halves of a transfer become one row. */
export function journalRows(s: InventorySnapshot, itemId: Id, movements: Movement[]): JournalRow[] {
  const ix = snapshotIndex(s)
  const unit = unitOf(s, ix.items.get(itemId))
  // Archived variants keep their names in the index, so old movements still name them.
  const nameOf = (variantId: Id | null): string | null => (variantId === null ? null : (ix.variants.get(variantId)?.name ?? null))

  const rows: JournalRow[] = []
  const transfers = new Map<Id, NonNullable<JournalRow['transfer']>>()
  for (const m of movements) {
    const sign = cmpQ(m.quantity, '0')
    const parts = formatAmountParts(sign < 0 ? negQ(m.quantity) : m.quantity, unit)
    const base = {
      at: m.createdAt,
      by: m.createdBy,
      unit: parts.unit,
      totalPrice: m.totalPrice,
      sourceUrl: m.sourceUrl,
      sourceHref: httpHref(m.sourceUrl),
      note: m.note,
    }

    if (m.kind === 'transfer' && m.transferId !== null) {
      // The outgoing half is negative; the first half met (the newest) places the row.
      const side = sign < 0 ? 'from' : 'to'
      const known = transfers.get(m.transferId)
      if (known) {
        known[side] = nameOf(m.variantId)
        continue
      }
      const transfer = { from: null, to: null, [side]: nameOf(m.variantId) }
      transfers.set(m.transferId, transfer)
      rows.push({ ...base, id: m.transferId, kind: 'transfer', number: parts.number, variantName: null, transfer })
      continue
    }

    const prefix = parts.number === '0' ? '' : sign > 0 ? '+' : sign < 0 ? MINUS : ''
    rows.push({ ...base, id: m.id, kind: m.kind, number: `${prefix}${parts.number}`, variantName: nameOf(m.variantId), transfer: null })
  }
  return rows
}
