import { folderArchived, type DraftNewFolder, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { byName, type MoveTarget } from '@antresol/kit/views'

// What an intake's draft folders look like on its screen (spec 2026-11-16 §4): a folder tree where existing folders and
// the draft's own are mixed, and a folder's path from the inventory root through both.

export interface FolderChoice extends MoveTarget {
  /** A folder of this draft, not created yet. */
  draft: boolean
}

const activeExisting = (s: InventorySnapshot, parentId: Id | null) =>
  s.folders.filter((f) => f.parentId === parentId && !folderArchived(s, f.id)).sort(byName)

/** Root first, then the existing folders not in the archive and the draft's folders, depth-first by name. `selected` is
 *  marked; `exceptId` (a draft folder being moved) is left out with everything under it. */
export function folderChoicesWithDraft(s: InventorySnapshot, draft: IntakeDraftContent, selected: Id | null, exceptId?: Id): FolderChoice[] {
  const own = draft.newFolders ?? []
  const out: FolderChoice[] = [{ id: null, name: s.inventory.name, depth: 0, current: selected === null, draft: false }]
  const walk = (parentId: Id | null, depth: number): void => {
    const rows = [
      ...activeExisting(s, parentId).map((f) => ({ id: f.id, name: f.name, draft: false })),
      ...own.filter((f) => f.parentId === parentId && f.id !== exceptId).map((f) => ({ id: f.id, name: f.name, draft: true })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'en'))
    for (const f of rows) {
      out.push({ id: f.id, name: f.name, depth, current: f.id === selected, draft: f.draft })
      walk(f.id, depth + 1)
    }
  }
  walk(null, 1)
  return out
}

/** Folder names from the root to the folder, through draft folders too; empty for the root or a folder that is gone. */
export function folderPathWithDraft(s: InventorySnapshot, draft: IntakeDraftContent, folderId: Id | null): string[] {
  const own = new Map((draft.newFolders ?? []).map((f) => [f.id, f] as const))
  const existing = new Map(s.folders.map((f) => [f.id, f] as const))
  const names: string[] = []
  const seen = new Set<Id>()
  for (let cur = folderId; cur !== null && !seen.has(cur); ) {
    seen.add(cur)
    const f: { name: string; parentId: Id | null } | undefined = own.get(cur) ?? existing.get(cur)
    if (!f) return []
    names.unshift(f.name)
    cur = f.parentId
  }
  return names
}

export interface FolderGroup {
  /** The nearest existing folder (or the root, null) the group hangs under, with its path for context. */
  parentId: Id | null
  context: string[]
  /** The group's draft folders depth-first: each with its depth below the context. */
  folders: { folder: DraftNewFolder; depth: number }[]
}

/** The draft folders as compact trees, one per nearest existing parent. */
export function folderGroups(s: InventorySnapshot, draft: IntakeDraftContent): FolderGroup[] {
  const own = draft.newFolders ?? []
  const ownIds = new Set(own.map((f) => f.id))
  const groups: FolderGroup[] = []
  const walk = (group: FolderGroup, parentId: Id, depth: number): void => {
    for (const f of own.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      group.folders.push({ folder: f, depth })
      walk(group, f.id, depth + 1)
    }
  }
  const roots = own.filter((f) => f.parentId === null || !ownIds.has(f.parentId))
  const parents: (Id | null)[] = []
  for (const f of roots) if (!parents.includes(f.parentId)) parents.push(f.parentId)
  for (const parentId of parents) {
    const group: FolderGroup = { parentId, context: folderPathWithDraft(s, draft, parentId), folders: [] }
    for (const f of roots.filter((x) => x.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      group.folders.push({ folder: f, depth: 0 })
      walk(group, f.id, 1)
    }
    groups.push(group)
  }
  return groups
}
