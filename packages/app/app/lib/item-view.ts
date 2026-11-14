import {
  addQ,
  BUILTIN_UNITS,
  cmpQ,
  compareVariants,
  formatAmountParts,
  formatAttributeValue,
  itemAxes,
  negQ,
  resolveUnit,
  unitPrice,
  variantDisplayLabel,
  keepValuesTogether,
  type Attribute,
  type AttributeKind,
  type Folder,
  type Id,
  type Intake,
  type InventorySnapshot,
  type Item,
  type Movement,
  type Photo,
  type MovementKind,
  type Quantity,
  type StockLine,
  type UnitDef,
} from '@antresol/core'
import { intakeTitle } from './intake-list'
import { byName, compareIds, pathOf, snapshotIndex, type Crumb } from './views'

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
  /** The variant's value on each of the item's axes, in axis order; `display` is `—` for an empty one. */
  values: { attributeId: Id; name: string; value: string | null; display: string }[]
  /** An axis has no value (an old or partly edited variant). */
  incomplete: boolean
}
export interface AxisRow {
  attributeId: Id
  name: string
  kind: AttributeKind
  options: string[]
  unit: string
  siPrefixes: boolean
}
/** A shared attribute of the item (axes are in `ItemView.axes`). */
export interface AttributeRow {
  attributeId: Id
  name: string
  kind: AttributeKind
  options: string[]
  unit: string
  siPrefixes: boolean
  value: string | null
  /** The value as shown (numbers by the attribute's unit rules); null when empty. */
  display: string | null
}
export interface ItemView {
  item: Item
  crumbs: Crumb[]
  unit: UnitDef
  currency: string
  tags: { id: Id; name: string }[]
  total: { quantity: Quantity; number: string; unit: string; outOfStock: boolean; avgUnitPrice: number | null; lastUnitPrice: number | null }
  /** The no-variant bucket first when shown, then active variants by their axis values. */
  buckets: BucketRow[]
  hasVariants: boolean
  /** The attributes the variants differ by, in axis order. */
  axes: AxisRow[]
  /** Shared attributes only, by name. */
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

/** The item's shared attributes (axes excluded), by name. */
function sharedAttributes(s: InventorySnapshot, itemId: Id): AttributeRow[] {
  const definitions = new Map(s.attributes.map((a) => [a.id, a] as const))
  return s.itemAttributes
    .filter((a) => a.itemId === itemId && a.axisPosition === null)
    .flatMap((a) => {
      const def = definitions.get(a.attributeId)
      if (!def) return []
      const value = valueOf(a.value)
      const display = value === null ? null : formatAttributeValue(def, value)
      return [{ attributeId: def.id, name: def.name, kind: def.kind, options: def.options, unit: def.unit, siPrefixes: def.siPrefixes, value, display }]
    })
    .sort((a, b) => byName(a, b) || compareIds(a.attributeId, b.attributeId))
}

/** One line about a bucket for the top of its sheets: the variant's label, the item's name, then the item's shared
 *  attribute values as they show on the card (at most three, empty ones skipped): "10 kΩ · Resistor 0.25 W · 5 %".
 *  `variantId` null (or unknown) is the item itself. Empty when the item is missing. */
export function bucketDescription(s: InventorySnapshot, itemId: Id, variantId: Id | null): string {
  const ix = snapshotIndex(s)
  const item = ix.items.get(itemId)
  if (!item) return ''
  const label = variantId === null ? null : (ix.variants.get(variantId)?.name ?? null)
  const values = sharedAttributes(s, itemId)
    .flatMap((a) => (a.display === null ? [] : [keepValuesTogether(a.display)]))
    .slice(0, 3)
  return [label, item.name, ...values].filter((part): part is string => !!part).join(' · ')
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

  const variants = s.variants.filter((v) => v.itemId === itemId && v.archivedAt === null).sort((a, b) => compareVariants(s, a, b))
  const hasVariants = variants.length > 0

  const axisAttributes = itemAxes(s, itemId)
  const axes: AxisRow[] = axisAttributes.map((a) => ({
    attributeId: a.id,
    name: a.name,
    kind: a.kind,
    options: a.options,
    unit: a.unit,
    siPrefixes: a.siPrefixes,
  }))

  const attributes = sharedAttributes(s, itemId)

  const variantValues = new Map<Id, Map<Id, string | null>>()
  const activeIds = new Set(variants.map((v) => v.id))
  for (const v of s.variantAttributeValues) {
    if (!activeIds.has(v.variantId)) continue
    const own = variantValues.get(v.variantId) ?? new Map<Id, string | null>()
    own.set(v.attributeId, valueOf(v.value))
    variantValues.set(v.variantId, own)
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
      incomplete: values.some((x) => x.value === null),
    }
  }
  const buckets: BucketRow[] = []
  if (!hasVariants || cmpQ(lineOf.get(null)?.quantity ?? '0', '0') !== 0) buckets.push(bucket(null, null, null, []))
  for (const v of variants) {
    const values = axisAttributes.map((a) => {
      const value = variantValues.get(v.id)?.get(a.id) ?? null
      return { attributeId: a.id, name: a.name, value, display: value === null ? '—' : keepValuesTogether(formatAttributeValue(a, value)) }
    })
    buckets.push(bucket(v.id, variantDisplayLabel(s, v), v.description, values))
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
    axes,
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
  /** Variant label (its axis values); null = no variant. Unused for transfers. */
  variantName: string | null
  transfer: { from: string | null; to: string | null } | null
  totalPrice: number | null
  /** As stored; show it as text only. */
  sourceUrl: string | null
  /** `sourceUrl` as a link target, only when it parses as an http(s) URL; null otherwise (never link it). */
  sourceHref: string | null
  note: string | null
  /** The bucket's quantity after this movement, as shown ("→ 45"); null for a transfer (two buckets). */
  balance: { number: string; unit: string } | null
  /** A recount that matched: an adjustment of zero ("Counted: 37 ✓"; spec 4.14). */
  counted: boolean
  /** The intake whose commit made this movement, when it is known (the cached list of intakes); null otherwise. */
  intake: { id: Id; title: string } | null
}

/** Core refuses other schemes on write, but a source can be written by other clients: check again before linking. */
export function httpHref(url: string | null): string | null {
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
export function journalRows(s: InventorySnapshot, itemId: Id, movements: Movement[], intakes: readonly Intake[] | null = null): JournalRow[] {
  const known = new Map((intakes ?? []).map((i) => [i.id, { id: i.id, title: intakeTitle(i.header) }]))
  const ix = snapshotIndex(s)
  const unit = unitOf(s, ix.items.get(itemId))
  // Archived variants keep their labels in the index, so old movements still name them.
  const nameOf = (variantId: Id | null): string | null => (variantId === null ? null : (ix.variants.get(variantId)?.name ?? null))

  // Running balance of each bucket, oldest first (the journal is the whole history of the item).
  const after = new Map<Id, Quantity>()
  const buckets = new Map<Id | null, Quantity>()
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i]!
    const quantity = addQ(buckets.get(m.variantId) ?? '0', m.quantity)
    buckets.set(m.variantId, quantity)
    after.set(m.id, quantity)
  }
  const balanceOf = (m: Movement): JournalRow['balance'] => {
    const quantity = after.get(m.id)
    return quantity === undefined ? null : formatAmountParts(quantity, unit)
  }

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
      rows.push({ ...base, id: m.transferId, kind: 'transfer', number: parts.number, variantName: null, transfer, balance: null, counted: false, intake: null })
      continue
    }

    const prefix = parts.number === '0' ? '' : sign > 0 ? '+' : sign < 0 ? MINUS : ''
    rows.push({
      ...base,
      id: m.id,
      kind: m.kind,
      number: `${prefix}${parts.number}`,
      variantName: nameOf(m.variantId),
      transfer: null,
      balance: balanceOf(m),
      counted: m.kind === 'adjustment' && sign === 0,
      intake: (m.intakeId !== null && known.get(m.intakeId)) || null,
    })
  }
  return rows
}

export interface JournalDay {
  /** The local calendar day, YYYY-MM-DD. */
  day: string
  /** Relative to now: show "Today" or "Yesterday"; null: show the date. */
  relative: 'today' | 'yesterday' | null
  /** Newest first, as given. */
  rows: JournalRow[]
}

const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Rows (newest first) grouped by the device's local calendar day (spec 4.14). */
export function journalDays(rows: JournalRow[], now: Date): JournalDay[] {
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const days: JournalDay[] = []
  for (const row of rows) {
    const day = localDay(new Date(row.at))
    const last = days.at(-1)
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, relative: day === today ? 'today' : day === yesterday ? 'yesterday' : null, rows: [row] })
  }
  return days
}
