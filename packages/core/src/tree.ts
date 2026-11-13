import type { Id } from './ids'
import type { Folder, InventorySnapshot, Item } from './model'

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

export function childFolders(s: InventorySnapshot, parentId: Id | null): Folder[] {
  return s.folders.filter((f) => f.archivedAt === null && f.parentId === parentId).sort(byName)
}

export function itemsInFolder(s: InventorySnapshot, folderId: Id | null): Item[] {
  return s.items.filter((i) => i.archivedAt === null && i.folderId === folderId).sort(byName)
}

/** Root-to-folder chain of active folders; empty if the folder is missing or archived. */
export function folderPath(s: InventorySnapshot, folderId: Id): Folder[] {
  const path: Folder[] = []
  const seen = new Set<Id>()
  let cur: Id | null = folderId
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const f: Folder | undefined = s.folders.find((x) => x.id === cur && x.archivedAt === null)
    if (!f) return []
    path.unshift(f)
    cur = f.parentId
  }
  return path
}

/** True if folderId is ancestorId or lies inside it. */
export function isInSubtree(s: InventorySnapshot, ancestorId: Id, folderId: Id): boolean {
  return folderPath(s, folderId).some((f) => f.id === ancestorId)
}

/** True if the folder or one of its ancestors is archived. A missing folder counts as not archived. */
export function folderArchived(s: InventorySnapshot, id: Id | null): boolean {
  const seen = new Set<Id>()
  let cur = id
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const f: Folder | undefined = s.folders.find((x) => x.id === cur)
    if (!f) return false
    if (f.archivedAt !== null) return true
    cur = f.parentId
  }
  return false
}

/** True if the item is archived itself or lies in an archived folder. */
export function itemArchived(s: InventorySnapshot, i: Item): boolean {
  return i.archivedAt !== null || folderArchived(s, i.folderId)
}
