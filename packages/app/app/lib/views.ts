import {
  BUILTIN_UNITS,
  bucketStock,
  childFolders,
  folderPath,
  formatAmountParts,
  isOutOfStock,
  itemsInFolder,
  itemStock,
  resolveUnit,
  type Folder,
  type Id,
  type InventorySnapshot,
  type Item,
  type SearchHit,
  type StockSummary,
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

function amount(s: InventorySnapshot, item: Item, stock: StockSummary): { number: string; unit: string } {
  const unit = resolveUnit(item.unitKey, s.units) ?? BUILTIN_UNITS.pcs
  return formatAmountParts(stock.quantity, unit)
}

/** Active items in the folder and in its active subfolders. */
function subtreeCounts(s: InventorySnapshot): Map<Id | null, number> {
  const counts = new Map<Id | null, number>()
  const walk = (parentId: Id | null): number => {
    let n = itemsInFolder(s, parentId).length
    for (const f of childFolders(s, parentId)) {
      const sub = walk(f.id)
      counts.set(f.id, sub)
      n += sub
    }
    return n
  }
  counts.set(null, walk(null))
  return counts
}

function itemRow(s: InventorySnapshot, item: Item): ItemRow {
  const stock = itemStock(s, item.id)
  const cover = s.photos
    .filter((p) => p.itemId === item.id && p.variantId === null)
    .sort((a, b) => a.position - b.position)[0]
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    variantCount: s.variants.filter((v) => v.itemId === item.id && v.archivedAt === null).length,
    ...amount(s, item, stock),
    outOfStock: isOutOfStock(stock),
    coverUrl: cover?.url ?? null,
  }
}

/** null when the folder is missing, archived, or under an archived ancestor. Root: folder null, crumbs []. */
export function folderView(s: InventorySnapshot, folderId: Id | null): FolderView | null {
  let path: Folder[] = []
  if (folderId !== null) {
    path = folderPath(s, folderId)
    if (path.length === 0) return null
  }
  const counts = subtreeCounts(s)
  return {
    folder: path.at(-1) ?? null,
    crumbs: path.map((f) => ({ id: f.id, name: f.name })),
    folders: childFolders(s, folderId).map((f) => ({ id: f.id, name: f.name, itemCount: counts.get(f.id) ?? 0 })),
    items: itemsInFolder(s, folderId).map((i) => itemRow(s, i)),
  }
}

/** ≤ max: unchanged; otherwise [first, 'ellipsis', ...last two]. */
export function collapseCrumbs(crumbs: Crumb[], max = 4): (Crumb | 'ellipsis')[] {
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
}

export function searchRows(s: InventorySnapshot, hits: SearchHit[]): SearchRow[] {
  const rows: SearchRow[] = []
  for (const hit of hits) {
    const item = s.items.find((i) => i.id === hit.itemId)
    if (!item) continue
    const variant = hit.variantId === null ? null : (s.variants.find((v) => v.id === hit.variantId) ?? null)
    const stock = variant ? bucketStock(s, item.id, variant.id) : itemStock(s, item.id)
    rows.push({
      itemId: item.id,
      variantId: variant?.id ?? null,
      name: item.name,
      variantName: variant?.name ?? null,
      ...amount(s, item, stock),
      outOfStock: isOutOfStock(stock),
      path: item.folderId === null ? '' : folderPath(s, item.folderId).map((f) => f.name).join(' / '),
    })
  }
  return rows
}

export interface TreeNode {
  id: Id
  name: string
  children: TreeNode[]
}

export function folderTree(s: InventorySnapshot): TreeNode[] {
  const build = (parentId: Id | null): TreeNode[] =>
    childFolders(s, parentId).map((f) => ({ id: f.id, name: f.name, children: build(f.id) }))
  return build(null)
}
