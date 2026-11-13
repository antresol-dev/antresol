import {
  addQ,
  BUILTIN_UNITS,
  cmpQ,
  compareVariants,
  createSearch,
  formatAmount,
  formatAmountParts,
  formatAttributeValue,
  itemAxes,
  resolveUnit,
  variantLabel,
  type Folder,
  type Id,
  type InventorySnapshot,
  type Item,
  type Quantity,
  type SearchHit,
  type StockLine,
  type UnitDef,
  type Variant,
} from '@antresol/core'
import type { PhotoRef } from './photo-url'

export interface Crumb {
  /** null is the inventory root; its name is the inventory name. */
  id: Id | null
  name: string
}
export interface FolderRow {
  id: Id
  name: string
  /** Pieces in stock over the active subtree (items counted in pcs only); null when no such item is in it. */
  pieces: Quantity | null
}
/** One bucket of an item with variants as its list row shows it: "10 kΩ 100". */
export interface ListBucket {
  /** The variant's label; null for the stock kept without a variant. */
  label: string | null
  /** The amount with its unit as a suffix: "100", "1.5k" (pieces), "3 m". */
  number: string
  /** Nothing in it (shown as "—"). */
  empty: boolean
}
export interface ItemRow {
  id: Id
  name: string
  description: string | null
  variantCount: number
  number: string
  /** The unit after the number, smaller (spec 4.3): '' for plain pieces, the prefix for many ("k"), else the symbol ("m"). */
  unit: string
  outOfStock: boolean
  cover: PhotoRef | null
  /** At most LIST_BUCKETS buckets, in variant order; the no-variant one first and only when it is not zero. [] without variants. */
  buckets: ListBucket[]
  /** Buckets left out after the first LIST_BUCKETS: "+2". */
  moreBuckets: number
  /** Values of the pinned attributes ("Show in lists"), by attribute name: "DIP-8", "B4". */
  pinned: string[]
}
export interface FolderView {
  folder: Folder | null
  crumbs: Crumb[]
  folders: FolderRow[]
  items: ItemRow[]
}

/** @internal The last key of every list order. Lists never keep the order of the snapshot's rows: a fresh load holds them
 *  in SQL order, a patched snapshot holds the rows a write returned at the end. */
export const compareIds = (a: Id, b: Id): number => (a < b ? -1 : a > b ? 1 : 0)

/** @internal Name order used by every list: case-insensitive, numbers in numeric order; equal names by id. */
export const byName = (a: { name: string; id?: Id }, b: { name: string; id?: Id }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || compareIds(a.id ?? '', b.id ?? '')

/** @internal Lookups built once per snapshot object (snapshots are replaced whole, never mutated); shared by views.ts and item-view.ts. */
export interface Index {
  items: Map<Id, Item>
  folders: Map<Id, Folder>
  /** Active folders and items by parent, sorted by name. */
  childFolders: Map<Id | null, Folder[]>
  folderItems: Map<Id | null, Item[]>
  /** Pieces in stock over the active subtree of a folder (pcs items only); null = none of them; key null is the inventory root. */
  subtreePieces: Map<Id | null, Quantity | null>
  stockByItem: Map<Id, StockLine[]>
  buckets: Map<string, StockLine>
  variants: Map<Id, { name: string; archived: boolean }>
  activeVariantCount: Map<Id, number>
  /** The photo with the lowest position and no variant, as display needs it (PhotoRef: url and renditions). */
  covers: Map<Id, PhotoRef>
  /** Lowest-position photo of each variant. */
  variantCovers: Map<Id, PhotoRef>
  paths: Map<Id, Folder[]>
  /** Active variants of each item in variant order (core compareVariants). */
  itemVariants: Map<Id, Variant[]>
  /** Each item's non-empty values of the pinned attributes, formatted, by attribute name. */
  pinned: Map<Id, string[]>
  /** Each variant's non-empty axis values by attribute. */
  variantValues: Map<Id, Map<Id, string>>
}

/** Test hook: counts how many times an index was built. */
export const indexStats = { builds: 0 }

const indexes = new WeakMap<InventorySnapshot, Index>()
const bucketKey = (itemId: Id, variantId: Id | null): string => `${itemId}\u0000${variantId ?? ''}`

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function buildIndex(s: InventorySnapshot): Index {
  indexStats.builds++
  const folders = new Map(s.folders.map((f) => [f.id, f] as const))
  const items = new Map(s.items.map((i) => [i.id, i] as const))

  const childFolders = new Map<Id | null, Folder[]>()
  for (const f of s.folders) if (f.archivedAt === null) push(childFolders, f.parentId, f)
  const folderItems = new Map<Id | null, Item[]>()
  for (const i of s.items) if (i.archivedAt === null) push(folderItems, i.folderId, i)
  for (const list of childFolders.values()) list.sort(byName)
  for (const list of folderItems.values()) list.sort(byName)

  const stockByItem = new Map<Id, StockLine[]>()
  const buckets = new Map<string, StockLine>()
  for (const l of s.stock) {
    push(stockByItem, l.itemId, l)
    buckets.set(bucketKey(l.itemId, l.variantId), l)
  }

  const variants = new Map<Id, { name: string; archived: boolean }>()
  const activeVariantCount = new Map<Id, number>()
  const itemVariants = new Map<Id, Variant[]>()
  for (const v of s.variants) {
    variants.set(v.id, { name: variantLabel(s, v), archived: v.archivedAt !== null })
    if (v.archivedAt === null) {
      activeVariantCount.set(v.itemId, (activeVariantCount.get(v.itemId) ?? 0) + 1)
      push(itemVariants, v.itemId, v)
    }
  }
  for (const list of itemVariants.values()) list.sort((a, b) => compareVariants(s, a, b))
  const variantValues = new Map<Id, Map<Id, string>>()
  for (const v of s.variantAttributeValues) {
    if (v.value === null || v.value.trim() === '') continue
    const own = variantValues.get(v.variantId) ?? new Map<Id, string>()
    own.set(v.attributeId, v.value)
    variantValues.set(v.variantId, own)
  }

  const pinnedAttributes = new Map(s.attributes.filter((a) => a.pinned).map((a) => [a.id, a] as const))
  const pinnedValues = new Map<Id, { name: string; id: Id; value: string }[]>()
  for (const a of s.itemAttributes) {
    const def = pinnedAttributes.get(a.attributeId)
    if (!def || a.axisPosition !== null || a.value === null || a.value.trim() === '') continue
    push(pinnedValues, a.itemId, { name: def.name, id: def.id, value: formatAttributeValue(def, a.value) })
  }
  const pinned = new Map<Id, string[]>()
  for (const [itemId, list] of pinnedValues) pinned.set(itemId, list.sort(byName).map((p) => p.value))

  const coverPos = new Map<Id, number>()
  const covers = new Map<Id, PhotoRef>()
  const variantPos = new Map<Id, number>()
  const variantCovers = new Map<Id, PhotoRef>()
  for (const p of s.photos) {
    const [pos, refs, key] = p.variantId === null ? [coverPos, covers, p.itemId] : [variantPos, variantCovers, p.variantId]
    const best = pos.get(key)
    if (best === undefined || p.position < best) {
      pos.set(key, p.position)
      refs.set(key, { url: p.url, urls: p.urls })
    }
  }

  const ix: Index = {
    items,
    folders,
    childFolders,
    folderItems,
    subtreePieces: new Map(),
    stockByItem,
    buckets,
    variants,
    activeVariantCount,
    covers,
    variantCovers,
    paths: new Map(),
    itemVariants,
    pinned,
    variantValues,
  }
  const pieces = (parentId: Id | null): Quantity | null => {
    let sum: Quantity | null = null
    for (const i of folderItems.get(parentId) ?? []) if (i.unitKey === 'pcs') sum = addQ(sum ?? '0', itemQuantity(ix, i.id))
    for (const f of childFolders.get(parentId) ?? []) {
      const sub = pieces(f.id)
      ix.subtreePieces.set(f.id, sub)
      if (sub !== null) sum = addQ(sum ?? '0', sub)
    }
    return sum
  }
  ix.subtreePieces.set(null, pieces(null))
  return ix
}

/** @internal The index of a snapshot, built on first use. */
export function snapshotIndex(s: InventorySnapshot): Index {
  let ix = indexes.get(s)
  if (!ix) {
    ix = buildIndex(s)
    indexes.set(s, ix)
  }
  return ix
}

/** @internal Root-to-folder chain of active folders; empty if the folder is missing, archived or under an archived ancestor. */
export function pathOf(ix: Index, folderId: Id): Folder[] {
  const cached = ix.paths.get(folderId)
  if (cached) return cached
  const path: Folder[] = []
  const seen = new Set<Id>()
  let cur: Id | null = folderId
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const f: Folder | undefined = ix.folders.get(cur)
    if (!f || f.archivedAt !== null) {
      path.length = 0
      break
    }
    path.unshift(f)
    cur = f.parentId
  }
  ix.paths.set(folderId, path)
  return path
}

/** Same rules as core's itemStock: every bucket of the item except archived variants. */
function itemQuantity(ix: Index, itemId: Id): Quantity {
  let quantity: Quantity = '0'
  for (const l of ix.stockByItem.get(itemId) ?? []) {
    if (l.variantId !== null && ix.variants.get(l.variantId)?.archived) continue
    quantity = addQ(quantity, l.quantity)
  }
  return quantity
}

const isEmpty = (q: Quantity): boolean => cmpQ(q, '0') <= 0

/** @internal Stock of one bucket, or of the whole item when `variantId` is undefined (archived variants left out). */
export function stockQuantity(s: InventorySnapshot, itemId: Id, variantId?: Id | null): Quantity {
  const ix = snapshotIndex(s)
  return variantId === undefined ? itemQuantity(ix, itemId) : (ix.buckets.get(bucketKey(itemId, variantId))?.quantity ?? '0')
}

const unitOf = (s: InventorySnapshot, item: Item): UnitDef => resolveUnit(item.unitKey, s.units) ?? BUILTIN_UNITS.pcs

function amount(s: InventorySnapshot, item: Item, quantity: Quantity): { number: string; unit: string } {
  return formatAmountParts(quantity, unitOf(s, item))
}

/** The amount with the unit as a suffix (spec 4.3): plain pieces have none. */
function suffixAmount(quantity: Quantity, unit: UnitDef): { number: string; unit: string } {
  const parts = formatAmountParts(quantity, unit)
  return unit.key === 'pcs' && parts.unit === unit.symbol ? { number: parts.number, unit: '' } : parts
}

/** Buckets a list row shows before "+N". */
export const LIST_BUCKETS = 4

function listBuckets(s: InventorySnapshot, ix: Index, item: Item): { buckets: ListBucket[]; moreBuckets: number } {
  const variants = ix.itemVariants.get(item.id) ?? []
  if (variants.length === 0) return { buckets: [], moreBuckets: 0 }
  const unit = unitOf(s, item)
  const bucket = (label: string | null, quantity: Quantity): ListBucket => {
    const { number, unit: suffix } = suffixAmount(quantity, unit)
    // A prefix of pieces sticks to the number ("1.5k"); a unit symbol is a word of its own ("3 m").
    const text = suffix === '' ? number : unit.key === 'pcs' ? `${number}${suffix}` : `${number} ${suffix}`
    return { label, number: text, empty: isEmpty(quantity) }
  }
  const all: ListBucket[] = []
  const loose = ix.buckets.get(bucketKey(item.id, null))?.quantity ?? '0'
  if (cmpQ(loose, '0') !== 0) all.push(bucket(null, loose))
  const axes = itemAxes(s, item.id)
  for (const v of variants) {
    // Axes joined by " / ", so " · " is left to separate the buckets: "100 nF / 50 V —".
    const label = axes.map((a) => {
      const value = ix.variantValues.get(v.id)?.get(a.id)
      return value ? formatAttributeValue(a, value) : '—'
    })
    all.push(bucket(label.join(' / '), ix.buckets.get(bucketKey(item.id, v.id))?.quantity ?? '0'))
  }
  return { buckets: all.slice(0, LIST_BUCKETS), moreBuckets: Math.max(0, all.length - LIST_BUCKETS) }
}

function itemRow(s: InventorySnapshot, ix: Index, item: Item): ItemRow {
  const quantity = itemQuantity(ix, item.id)
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    variantCount: ix.activeVariantCount.get(item.id) ?? 0,
    ...suffixAmount(quantity, unitOf(s, item)),
    outOfStock: isEmpty(quantity),
    cover: ix.covers.get(item.id) ?? null,
    ...listBuckets(s, ix, item),
    pinned: ix.pinned.get(item.id) ?? [],
  }
}

/** The values of the item's pinned attributes, as list rows show them (for the item card's header). */
export function pinnedValues(s: InventorySnapshot, itemId: Id): string[] {
  return snapshotIndex(s).pinned.get(itemId) ?? []
}

/** null when the folder is missing, archived, or under an archived ancestor. Root: folder null, crumbs []. */
export function folderView(s: InventorySnapshot, folderId: Id | null): FolderView | null {
  const ix = snapshotIndex(s)
  let path: Folder[] = []
  if (folderId !== null) {
    path = pathOf(ix, folderId)
    if (path.length === 0) return null
  }
  return {
    folder: path.at(-1) ?? null,
    crumbs: path.map((f) => ({ id: f.id, name: f.name })),
    folders: (ix.childFolders.get(folderId) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      pieces: ix.subtreePieces.get(f.id) ?? null,
    })),
    items: (ix.folderItems.get(folderId) ?? []).map((i) => itemRow(s, ix, i)),
  }
}

/** ≤ max: unchanged; otherwise [first, 'ellipsis', ...last two]. */
export function collapseCrumbs<T>(crumbs: T[], max = 4): (T | 'ellipsis')[] {
  if (crumbs.length <= max) return crumbs
  return [crumbs[0]!, 'ellipsis', ...crumbs.slice(-2)]
}

export interface SearchRow {
  itemId: Id
  variantId: Id | null
  name: string
  variantName: string | null
  number: string
  unit: string
  outOfStock: boolean
  path: string
  /** The matched variant's photo, else the item's cover. */
  cover: PhotoRef | null
  /** The item's pinned values (as ItemRow.pinned). */
  pinned: string[]
  /** number and unit in one: "4 pcs", "1.5k", "3 m". */
  amount: string
  /** The item has variants (a hit without `variantId` then is the item itself, not a stock bucket to receive into). */
  hasVariants: boolean
}

export function searchRows(s: InventorySnapshot, hits: SearchHit[]): SearchRow[] {
  const ix = snapshotIndex(s)
  const rows: SearchRow[] = []
  for (const hit of hits) {
    const item = ix.items.get(hit.itemId)
    if (!item) continue
    const variant = hit.variantId === null ? null : (ix.variants.get(hit.variantId) ?? null)
    const quantity =
      hit.variantId !== null && variant
        ? (ix.buckets.get(bucketKey(item.id, hit.variantId))?.quantity ?? '0')
        : itemQuantity(ix, item.id)
    rows.push({
      itemId: item.id,
      variantId: variant ? hit.variantId : null,
      name: item.name,
      variantName: variant?.name ?? null,
      ...amount(s, item, quantity),
      amount: formatAmount(quantity, unitOf(s, item)),
      outOfStock: isEmpty(quantity),
      path: item.folderId === null ? '' : pathOf(ix, item.folderId).map((f) => f.name).join(' / '),
      cover: (variant && hit.variantId !== null ? ix.variantCovers.get(hit.variantId) : undefined) ?? ix.covers.get(item.id) ?? null,
      pinned: ix.pinned.get(item.id) ?? [],
      hasVariants: (ix.itemVariants.get(item.id) ?? []).length > 0,
    })
  }
  return rows
}

export type SnapshotSearch = ReturnType<typeof createSearch>
const searches = new WeakMap<InventorySnapshot, SnapshotSearch>()

/** Core search over a snapshot, built once per snapshot object (the palette, quick add and the share sheet share it). */
export function snapshotSearch(s: InventorySnapshot): SnapshotSearch {
  let search = searches.get(s)
  if (!search) {
    search = createSearch(s)
    searches.set(s, search)
  }
  return search
}

export interface TreeNode {
  id: Id
  name: string
  /** Pieces in the subtree, the same number as in the folder list; null = no item in pcs. */
  pieces: Quantity | null
  children: TreeNode[]
}

export function folderTree(s: InventorySnapshot): TreeNode[] {
  const ix = snapshotIndex(s)
  const build = (parentId: Id | null): TreeNode[] =>
    (ix.childFolders.get(parentId) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      pieces: ix.subtreePieces.get(f.id) ?? null,
      children: build(f.id),
    }))
  return build(null)
}

/** Pieces in the whole inventory (pcs items not under an archived folder); null when it has none. */
export function inventoryPieces(s: InventorySnapshot): Quantity | null {
  return snapshotIndex(s).subtreePieces.get(null) ?? null
}

/** A folder's piece sum as the tree and folder list show it: a bare number, and with the k/M prefix at most three
 *  significant digits ("5", "999", "1.65k", "12.3k", "123k", "1.2M"). An item's own quantity stays exact: use
 *  formatAmount for it. */
export function piecesLabel(q: Quantity): string {
  const { number, unit } = formatAmountParts(q, BUILTIN_UNITS.pcs)
  if (unit === BUILTIN_UNITS.pcs.symbol) return number
  const digits = Math.max(0, 3 - number.split('.')[0]!.replace('-', '').length)
  const fixed = Number(number).toFixed(digits)
  const rounded = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
  // 999.9k rounds up to a thousand: that is one M.
  if (unit === 'k' && rounded === '1000') return '1M'
  return `${rounded}${unit}`
}

export interface MoveTarget {
  /** null is the inventory root; its name is the inventory name. */
  id: Id | null
  name: string
  depth: number
  /** The folder's present parent. */
  current: boolean
}

/** Root first, then active folders depth-first by name; excludes the folder itself and its subtree. */
export function moveTargets(s: InventorySnapshot, folderId: Id): MoveTarget[] {
  const ix = snapshotIndex(s)
  const parentId = ix.folders.get(folderId)?.parentId ?? null
  const out: MoveTarget[] = [{ id: null, name: s.inventory.name, depth: 0, current: parentId === null }]
  const walk = (pid: Id | null, depth: number): void => {
    for (const f of ix.childFolders.get(pid) ?? []) {
      if (f.id === folderId) continue
      out.push({ id: f.id, name: f.name, depth, current: f.id === parentId })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

/** Root first (id null, inventory name), then every active folder depth-first by name; `current` marks `selected`. */
export function folderChoices(s: InventorySnapshot, selected: Id | null): MoveTarget[] {
  const ix = snapshotIndex(s)
  const out: MoveTarget[] = [{ id: null, name: s.inventory.name, depth: 0, current: selected === null }]
  const walk = (pid: Id | null, depth: number): void => {
    for (const f of ix.childFolders.get(pid) ?? []) {
      out.push({ id: f.id, name: f.name, depth, current: f.id === selected })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}
