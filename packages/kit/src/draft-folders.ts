import { folderArchived, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { byName, type MoveTarget } from './views'

/** Folders of an intake as the draft sees them: the inventory's own and the draft's, mixed (spec 2026-11-16 §4).
 *  One rule for archived folders: a path is shown through them (a draft folder under an archived one still reads in
 *  full), while an archived folder is never offered as a choice. */

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

/** Folder names from the root to the folder, through draft folders too and through archived ones; empty for the root
 *  or a folder that is gone. */
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
