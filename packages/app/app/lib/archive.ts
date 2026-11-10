import type { Id, InventorySnapshot } from '@graymatter/core'

export interface ArchiveEntry {
  archiveId: Id
  target: 'folder' | 'item' | 'variant'
  id: Id
  name: string
  /** For a variant: its item's name; otherwise null. */
  itemName: string | null
  /** Folder names from the root to the containing folder, archived folders included; '' at the root. */
  path: string
  archivedAt: string
  /** Folder entries: folders and items archived together with it (same archiveId), the folder itself excluded. */
  folderCount: number
  itemCount: number
}

/** One entry per archive operation in the current inventory, newest first. */
export function archiveEntries(s: InventorySnapshot): ArchiveEntry[] {
  const folderById = new Map(s.folders.map((f) => [f.id, f]))
  const itemById = new Map(s.items.map((i) => [i.id, i]))

  const pathOf = (folderId: Id | null): string => {
    const names: string[] = []
    const seen = new Set<Id>()
    for (let cur = folderId; cur !== null && !seen.has(cur); ) {
      seen.add(cur)
      const f = folderById.get(cur)
      if (!f) break
      names.unshift(f.name)
      cur = f.parentId
    }
    return names.join(' / ')
  }

  const foldersBy = new Map<Id, number>()
  const itemsBy = new Map<Id, number>()
  const bump = (m: Map<Id, number>, k: Id): void => void m.set(k, (m.get(k) ?? 0) + 1)
  for (const f of s.folders) if (f.archiveId !== null) bump(foldersBy, f.archiveId)
  for (const i of s.items) if (i.archiveId !== null) bump(itemsBy, i.archiveId)

  const entries: ArchiveEntry[] = []
  for (const f of s.folders) {
    if (f.archiveId === null || f.archivedAt === null) continue
    const parent = f.parentId === null ? undefined : folderById.get(f.parentId)
    if (parent && parent.archiveId === f.archiveId) continue
    entries.push({
      archiveId: f.archiveId,
      target: 'folder',
      id: f.id,
      name: f.name,
      itemName: null,
      path: pathOf(f.parentId),
      archivedAt: f.archivedAt,
      folderCount: (foldersBy.get(f.archiveId) ?? 1) - 1,
      itemCount: itemsBy.get(f.archiveId) ?? 0,
    })
  }
  for (const i of s.items) {
    if (i.archiveId === null || i.archivedAt === null) continue
    const folder = i.folderId === null ? undefined : folderById.get(i.folderId)
    if (folder && folder.archiveId === i.archiveId) continue
    entries.push({
      archiveId: i.archiveId,
      target: 'item',
      id: i.id,
      name: i.name,
      itemName: null,
      path: pathOf(i.folderId),
      archivedAt: i.archivedAt,
      folderCount: 0,
      itemCount: 0,
    })
  }
  for (const v of s.variants) {
    if (v.archiveId === null || v.archivedAt === null) continue
    const item = itemById.get(v.itemId)
    entries.push({
      archiveId: v.archiveId,
      target: 'variant',
      id: v.id,
      name: v.name,
      itemName: item?.name ?? null,
      path: pathOf(item?.folderId ?? null),
      archivedAt: v.archivedAt,
      folderCount: 0,
      itemCount: 0,
    })
  }
  return entries.sort((a, b) => (a.archivedAt === b.archivedAt ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.archivedAt < b.archivedAt ? 1 : -1))
}
