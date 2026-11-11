import {
  addQ,
  BUILTIN_UNITS,
  cmpQ,
  formatAmountParts,
  resolveUnit,
  type Folder,
  type Id,
  type InventorySnapshot,
  type Item,
  type Quantity,
  type SearchHit,
  type StockLine,
} from '@graymatter/core'

export interface Crumb {
  /** null is the inventory root; its name is the inventory name. */
  id: Id | null
  name: string
}
export interface FolderRow {
  id: Id
  name: string
  /** Active items anywhere in the subtree. */
  itemCount: number
}
export interface ItemRow {
  id: Id
  name: string
  description: string | null
  variantCount: number
  number: string
  unit: string
  outOfStock: boolean
  coverUrl: string | null
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
  /** Active items in the whole active subtree of a folder; key null is the inventory root. */
  subtreeCounts: Map<Id | null, number>
  stockByItem: Map<Id, StockLine[]>
  buckets: Map<string, StockLine>
  variants: Map<Id, { name: string; archived: boolean }>
  activeVariantCount: Map<Id, number>
  /** url of the photo with the lowest position and no variant. */
  covers: Map<Id, string>
  /** Lowest-position photo of each variant. */
  variantCovers: Map<Id, string>
  paths: Map<Id, Folder[]>
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

  const subtreeCounts = new Map<Id | null, number>()
  const count = (parentId: Id | null): number => {
    let n = folderItems.get(parentId)?.length ?? 0
    for (const f of childFolders.get(parentId) ?? []) {
      const sub = count(f.id)
      subtreeCounts.set(f.id, sub)
      n += sub
    }
    return n
  }
  subtreeCounts.set(null, count(null))

  const stockByItem = new Map<Id, StockLine[]>()
  const buckets = new Map<string, StockLine>()
  for (const l of s.stock) {
    push(stockByItem, l.itemId, l)
    buckets.set(bucketKey(l.itemId, l.variantId), l)
  }

  const variants = new Map<Id, { name: string; archived: boolean }>()
  const activeVariantCount = new Map<Id, number>()
  for (const v of s.variants) {
    variants.set(v.id, { name: v.name, archived: v.archivedAt !== null })
    if (v.archivedAt === null) activeVariantCount.set(v.itemId, (activeVariantCount.get(v.itemId) ?? 0) + 1)
  }

  const coverPos = new Map<Id, number>()
  const covers = new Map<Id, string>()
  const variantPos = new Map<Id, number>()
  const variantCovers = new Map<Id, string>()
  for (const p of s.photos) {
    const [pos, urls, key] = p.variantId === null ? [coverPos, covers, p.itemId] : [variantPos, variantCovers, p.variantId]
    const best = pos.get(key)
    if (best === undefined || p.position < best) {
      pos.set(key, p.position)
      urls.set(key, p.url)
    }
  }

  return { items, folders, childFolders, folderItems, subtreeCounts, stockByItem, buckets, variants, activeVariantCount, covers, variantCovers, paths: new Map() }
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

function amount(s: InventorySnapshot, item: Item, quantity: Quantity): { number: string; unit: string } {
  const unit = resolveUnit(item.unitKey, s.units) ?? BUILTIN_UNITS.pcs
  return formatAmountParts(quantity, unit)
}

function itemRow(s: InventorySnapshot, ix: Index, item: Item): ItemRow {
  const quantity = itemQuantity(ix, item.id)
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    variantCount: ix.activeVariantCount.get(item.id) ?? 0,
    ...amount(s, item, quantity),
    outOfStock: isEmpty(quantity),
    coverUrl: ix.covers.get(item.id) ?? null,
  }
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
      itemCount: ix.subtreeCounts.get(f.id) ?? 0,
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
  coverUrl: string | null
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
      outOfStock: isEmpty(quantity),
      path: item.folderId === null ? '' : pathOf(ix, item.folderId).map((f) => f.name).join(' / '),
      coverUrl: (variant && hit.variantId !== null ? ix.variantCovers.get(hit.variantId) : undefined) ?? ix.covers.get(item.id) ?? null,
    })
  }
  return rows
}

export interface TreeNode {
  id: Id
  name: string
  /** Active items anywhere in the subtree, the same number as in the folder list. */
  itemCount: number
  children: TreeNode[]
}

export function folderTree(s: InventorySnapshot): TreeNode[] {
  const ix = snapshotIndex(s)
  const build = (parentId: Id | null): TreeNode[] =>
    (ix.childFolders.get(parentId) ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      itemCount: ix.subtreeCounts.get(f.id) ?? 0,
      children: build(f.id),
    }))
  return build(null)
}

/** Active items in the whole inventory (not under an archived folder). */
export function inventoryItemCount(s: InventorySnapshot): number {
  return snapshotIndex(s).subtreeCounts.get(null) ?? 0
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
