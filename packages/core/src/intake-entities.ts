import type { Id } from './ids'
import type { DraftNewAttribute, DraftNewFolder, EntityProblem, IntakeDraftContent } from './intakes'
import { MAX_ATTRIBUTE_UNIT_LENGTH, MAX_NAME_LENGTH } from './limits'
import type { Attribute, AttributeKind, InventorySnapshot } from './model'
import { folderArchived } from './tree'

/** The folders and attributes an intake draft creates (spec 2026-11-16 intake entities §3, §7): what keeps each from
 *  being created against a copy of the inventory, and the order the commit creates them in. */

const KINDS: readonly AttributeKind[] = ['text', 'enum', 'number']
const NO_AUDIT = { createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
export const goodName = (name: string) => {
  const t = name.trim()
  return t !== '' && t.length <= MAX_NAME_LENGTH
}

/** A draft attribute as the attribute the commit makes of it: trimmed, and a unit only on a number. */
export function draftAttribute(a: DraftNewAttribute, inventoryId: Id): Attribute {
  const number = a.kind === 'number'
  return {
    id: a.id,
    inventoryId,
    name: a.name.trim(),
    kind: a.kind,
    options: a.options.map((o) => o.trim()),
    unit: number ? a.unit.trim() : '',
    siPrefixes: number && a.siPrefixes,
    pinned: false,
    ...NO_AUDIT,
  }
}

/** The attributes a new item of the draft may use, by id: the copy's and the draft's (one in the copy wins). */
export function intakeAttributes(draft: IntakeDraftContent, s: InventorySnapshot): Map<Id, Attribute> {
  const all = new Map<Id, Attribute>((draft.newAttributes ?? []).map((a) => [a.id, draftAttribute(a, s.inventory.id)] as const))
  for (const a of s.attributes) all.set(a.id, a)
  return all
}

/**
 * What keeps each draft folder from being created, in draft order: a bad name (invalid_value); a parent chain through
 * draft folders that comes back to itself (cycle); a parent that is neither a draft folder nor an active folder of the
 * copy (parent_gone); a name equal (trim, no case) to an active folder or an earlier draft folder under the same parent
 * (duplicate_name, naming that folder).
 */
export function draftFolderProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  const folders = draft.newFolders ?? []
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const problemOf = (f: DraftNewFolder, index: number): EntityProblem | null => {
    if (!goodName(f.name)) return { code: 'invalid_value' }
    const seen = new Set<Id>([f.id])
    for (let cur = f.parentId; cur !== null && byId.has(cur); cur = byId.get(cur)!.parentId) {
      if (seen.has(cur)) return { code: 'cycle' }
      seen.add(cur)
    }
    if (f.parentId !== null && !byId.has(f.parentId)) {
      if (!s.folders.some((x) => x.id === f.parentId) || folderArchived(s, f.parentId)) return { code: 'parent_gone' }
    }
    const existing =
      s.folders.find((x) => x.id !== f.id && x.parentId === f.parentId && !folderArchived(s, x.id) && sameName(x.name, f.name)) ??
      folders.slice(0, index).find((x) => x.parentId === f.parentId && sameName(x.name, f.name))
    return existing ? { code: 'duplicate_name', existingId: existing.id } : null
  }
  return folders.map((f, i) => ({ id: f.id, problem: problemOf(f, i) }))
}

/** What keeps each draft attribute from being created, in draft order: a bad name, kind or unit (invalid_value); a name
 *  equal (trim, no case) to any attribute of the copy or an earlier draft attribute (duplicate_name). */
export function draftAttributeProblems(draft: IntakeDraftContent, s: InventorySnapshot): { id: Id; problem: EntityProblem | null }[] {
  const attributes = draft.newAttributes ?? []
  const problemOf = (a: DraftNewAttribute, index: number): EntityProblem | null => {
    if (!goodName(a.name) || !KINDS.includes(a.kind)) return { code: 'invalid_value' }
    if (a.kind === 'number' && a.unit.trim().length > MAX_ATTRIBUTE_UNIT_LENGTH) return { code: 'invalid_value' }
    const existing =
      s.attributes.find((x) => x.id !== a.id && sameName(x.name, a.name)) ??
      attributes.slice(0, index).find((x) => sameName(x.name, a.name))
    return existing ? { code: 'duplicate_name', existingId: existing.id } : null
  }
  return attributes.map((a, i) => ({ id: a.id, problem: problemOf(a, i) }))
}

/** The draft folders with every parent before its children. Throws on a cycle (resolve the draft first). */
export function foldersParentsFirst(folders: readonly DraftNewFolder[]): DraftNewFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const out: DraftNewFolder[] = []
  const done = new Set<Id>()
  const visiting = new Set<Id>()
  const visit = (f: DraftNewFolder) => {
    if (done.has(f.id)) return
    if (visiting.has(f.id)) throw new Error(`foldersParentsFirst: folder ${f.id} is its own ancestor`)
    visiting.add(f.id)
    const parent = f.parentId === null ? undefined : byId.get(f.parentId)
    if (parent) visit(parent)
    done.add(f.id)
    out.push(f)
  }
  for (const f of folders) visit(f)
  return out
}
