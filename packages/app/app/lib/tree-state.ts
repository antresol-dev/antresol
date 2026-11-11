import type { Id, InventorySnapshot, Quantity } from '@graymatter/core'
import { folderTree, folderView, type TreeNode } from './views'

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
  /** Rows of the children; empty while closed. */
  children: TreeRow[]
}

/** A click on a folder row: on the folder that is not open yet it selects (goes there, the branch stays as it is);
 *  on the folder whose own screen is open it opens or closes the branch. */
export function rowClickAction(isPage: boolean): 'select' | 'toggle' {
  return isPage ? 'toggle' : 'select'
}

export function treeRows(s: InventorySnapshot, open: TreeOpen, current: Id | 'root' | null): TreeRow[] {
  const build = (nodes: TreeNode[]): TreeRow[] =>
    nodes.map((n) => {
      const hasChildren = n.children.length > 0
      const isOpen = hasChildren && open[n.id] === true
      return {
        id: n.id,
        name: n.name,
        pieces: n.pieces,
        hasChildren,
        open: isOpen,
        current: n.id === current,
        children: isOpen ? build(n.children) : [],
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

export function toggleOpen(open: TreeOpen, id: Id): TreeOpen {
  if (open[id] !== true) return { ...open, [id]: true }
  const { [id]: _closed, ...rest } = open
  return rest
}

const storageKey = (inventoryId: Id): string => `gm-tree:${inventoryId}`

/** localStorage key `gm-tree:<inventoryId>`; {} when missing, unreadable or the storage throws. */
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
