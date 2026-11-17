import type { DraftNewFolder, Id, IntakeDraftContent, InventorySnapshot } from '@antresol/core'
import { folderPathWithDraft } from '@antresol/kit/draft-folders'

// The draft's own folders on its screen (spec 2026-11-16 §4). Choices and paths are in @antresol/kit.

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
