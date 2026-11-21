import type { Id, InventorySnapshot, Item, Quantity } from '@antresol/core'
import { byName, folderTree, folderView, type TreeNode } from './views'

/** Folder ids the user has open. Absent = closed: folders start collapsed. */
export type TreeOpen = Record<Id, true>

export interface TreeRow {
  id: Id
  name: string
  /** Pieces in the subtree (pcs items only), the same number as in the folder list; null = none to count. */
  pieces: Quantity | null
  hasChildren: boolean
  open: boolean
  current: boolean
  /** The folder's icon name (isIconName), or null for the plain folder icon. */
  icon: string | null
  /** Rows of the children; empty while closed. */
  children: TreeRow[]
  /** "Show items": the folder's own items, by name, after its folders; empty while closed or with the option off. */
  items: TreeItemRow[]
}

/** An item in the tree ("Show items"): its icon (own, else its folder's) in its colour, like a file in an editor's tree. */
export interface TreeItemRow {
  id: Id
  name: string
  icon: string | null
  folderIcon: string | null
  color: string | null
  current: boolean
}

/** The active items of a folder (null: the root) as tree rows, by name. */
function itemRowsIn(s: InventorySnapshot, folderId: Id | null, folderIcon: string | null, currentItem: Id | null): TreeItemRow[] {
  return s.items
    .filter((i: Item) => i.folderId === folderId && i.archivedAt === null)
    .sort(byName)
    .map((i) => ({ id: i.id, name: i.name, icon: i.icon ?? null, folderIcon, color: i.color ?? null, current: i.id === currentItem }))
}

/** "Show items": the items in the inventory root, by name; they come after the root's folders. */
export function rootItemRows(s: InventorySnapshot, currentItem: Id | null): TreeItemRow[] {
  return itemRowsIn(s, null, null, currentItem)
}

/** A click on a folder row: on the folder that is not open yet it selects (goes there, the branch stays as it is);
 *  on the folder whose own screen is open it opens or closes the branch. */
export function rowClickAction(isPage: boolean): 'select' | 'toggle' {
  return isPage ? 'toggle' : 'select'
}

/** A fired long press on a folder row also opens it when it has children and is closed; the menu opens either way. */
export function longPressExpands(hasChildren: boolean, isOpen: boolean): boolean {
  return hasChildren && !isOpen
}

/** The tree's folder rows. With `items` ("Show items") an open folder also lists its own items, and a folder that holds
 *  only items gets a chevron too. */
export function treeRows(s: InventorySnapshot, open: TreeOpen, current: Id | 'root' | null, items?: { currentItem: Id | null }): TreeRow[] {
  const icons = new Map(s.folders.map((f) => [f.id, f.icon ?? null] as const))
  const holdsItems = items ? new Set(s.items.filter((i) => i.archivedAt === null && i.folderId !== null).map((i) => i.folderId!)) : null
  const build = (nodes: TreeNode[]): TreeRow[] =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0 || (holdsItems?.has(n.id) ?? false)
      const isOpen = hasChildren && open[n.id] === true
      const icon = icons.get(n.id) ?? null
      return {
        id: n.id,
        name: n.name,
        pieces: n.pieces,
        hasChildren,
        open: isOpen,
        current: n.id === current,
        icon,
        children: isOpen ? build(n.children) : [],
        items: isOpen && items ? itemRowsIn(s, n.id, icon, items.currentItem) : [],
      }
    })
  return build(folderTree(s))
}

/** Opens every ancestor of folderId, not the folder itself; returns the same object when nothing changes. */
export function openPath(s: InventorySnapshot, open: TreeOpen, folderId: Id | null): TreeOpen {
  if (folderId === null) return open
  // Active root-to-folder chain; null when the folder is missing or under an archived folder.
  const chain = folderView(s, folderId)?.crumbs ?? []
  const closed = chain.slice(0, -1).filter((c) => c.id !== null && open[c.id] !== true)
  if (closed.length === 0) return open
  const next: TreeOpen = { ...open }
  for (const c of closed) next[c.id!] = true
  return next
}

/** Every folder closed. */
export function collapseAll(): TreeOpen {
  return {}
}

/** Every active folder that has children open; with `withItems` ("Show items") also the folders that hold only items. */
export function expandAll(s: InventorySnapshot, withItems = false): TreeOpen {
  const open: TreeOpen = {}
  const holdsItems = withItems ? new Set(s.items.filter((i) => i.archivedAt === null).map((i) => i.folderId)) : new Set<Id | null>()
  const walk = (nodes: TreeNode[]): void => {
    for (const n of nodes) {
      if (n.children.length === 0 && !holdsItems.has(n.id)) continue
      open[n.id] = true
      walk(n.children)
    }
  }
  walk(folderTree(s))
  return open
}

export function toggleOpen(open: TreeOpen, id: Id): TreeOpen {
  if (open[id] !== true) return { ...open, [id]: true }
  const { [id]: _closed, ...rest } = open
  return rest
}

const storageKey = (inventoryId: Id): string => `antresol-tree:${inventoryId}`

/** localStorage key `antresol-tree:<inventoryId>`; {} when missing, unreadable or the storage throws. */
export function loadTreeOpen(inventoryId: Id): TreeOpen {
  try {
    const raw = localStorage.getItem(storageKey(inventoryId))
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const open: TreeOpen = {}
    for (const [id, value] of Object.entries(parsed)) if (value === true) open[id] = true
    return open
  } catch {
    return {}
  }
}

/** Failures are ignored: the tree state is a convenience. */
export function saveTreeOpen(inventoryId: Id, open: TreeOpen): void {
  try {
    localStorage.setItem(storageKey(inventoryId), JSON.stringify(open))
  } catch {
    // Private mode, a full quota or blocked storage: the tree just starts collapsed next time.
  }
}

const ITEMS_KEY = 'antresol-tree-items'

/** "Show items" in the tree, kept on this device (localStorage `antresol-tree-items`, '1' or '0'); off when missing,
 *  unreadable or the storage throws. */
export function loadTreeItems(): boolean {
  try {
    return localStorage.getItem(ITEMS_KEY) === '1'
  } catch {
    return false
  }
}

/** Failures are ignored, like the open folders: the option is a convenience. */
export function saveTreeItems(on: boolean): void {
  try {
    localStorage.setItem(ITEMS_KEY, on ? '1' : '0')
  } catch {
    // Private mode, a full quota or blocked storage: the tree just starts without items next time.
  }
}
