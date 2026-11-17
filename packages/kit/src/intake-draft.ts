import {
  folderArchived,
  MAX_ATTRIBUTE_UNIT_LENGTH,
  MAX_NAME_LENGTH,
  newId,
  pruneNewItems,
  sameName as same,
  type DraftLine,
  type DraftNewAttribute,
  type DraftNewFolder,
  type DraftNewItem,
  type DraftNewTag,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
} from '@antresol/core'

/** Editing the draft's own parts (spec 2026-11-16 intake entities §3-§4): draft folders, draft attributes, new items
 *  that live on their own, and "use existing". Pure: each returns a new draft, or what to fix. */

export interface DraftError {
  errorKey: string
  params?: Record<string, string>
}

const KINDS = ['text', 'enum', 'number']
const upsert = <T extends { id: Id }>(list: readonly T[], x: T): T[] =>
  list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]

/** The folder or attribute that already has this name (trim, no case): a folder under the same parent (existing ones
 *  not in the archive first, then the draft's), an attribute anywhere. `draft`: the clash is with a draft entity.
 *  `exceptId`: the entity being edited, which does not clash with itself. */
export function nameClash(
  s: InventorySnapshot,
  draft: IntakeDraftContent,
  q: { kind: 'folder'; name: string; parentId: Id | null } | { kind: 'attribute'; name: string },
  exceptId?: Id,
): { id: Id; draft: boolean } | null {
  if (q.kind === 'folder') {
    const existing = s.folders.find((f) => f.id !== exceptId && f.parentId === q.parentId && !folderArchived(s, f.id) && same(f.name, q.name))
    if (existing) return { id: existing.id, draft: false }
    const own = (draft.newFolders ?? []).find((f) => f.id !== exceptId && f.parentId === q.parentId && same(f.name, q.name))
    return own ? { id: own.id, draft: true } : null
  }
  const existing = s.attributes.find((a) => a.id !== exceptId && same(a.name, q.name))
  if (existing) return { id: existing.id, draft: false }
  const own = (draft.newAttributes ?? []).find((a) => a.id !== exceptId && same(a.name, q.name))
  return own ? { id: own.id, draft: true } : null
}

const nameError = (name: string): DraftError | null =>
  name.trim() === ''
    ? { errorKey: 'errors.domain.name_required' }
    : name.trim().length > MAX_NAME_LENGTH
      ? { errorKey: 'errors.domain.name_too_long' }
      : null

/** The draft with the folder put in (in its place when it is there already), or what to fix: a bad name, a parent that
 *  is the folder itself or one of its descendants (`intakes.folder.cycle`), a parent that is gone
 *  (`intakes.folder.parentGone`), a name the parent already has (`intakes.folder.duplicate`, params `name` and the
 *  existing folder's `id`). */
export function withNewFolder(draft: IntakeDraftContent, s: InventorySnapshot, folder: DraftNewFolder): IntakeDraftContent | DraftError {
  const name = folder.name.trim()
  const bad = nameError(name)
  if (bad) return bad
  const folders = draft.newFolders ?? []
  const byId = new Map(folders.map((f) => [f.id, f] as const))
  const seen = new Set<Id>([folder.id])
  for (let cur = folder.parentId; cur !== null && (cur === folder.id || byId.has(cur)); cur = byId.get(cur)!.parentId) {
    if (seen.has(cur)) return { errorKey: 'intakes.folder.cycle' }
    seen.add(cur)
  }
  if (folder.parentId !== null && !byId.has(folder.parentId)) {
    if (!s.folders.some((f) => f.id === folder.parentId) || folderArchived(s, folder.parentId)) return { errorKey: 'intakes.folder.parentGone' }
  }
  const clash = nameClash(s, draft, { kind: 'folder', name, parentId: folder.parentId }, folder.id)
  if (clash) return { errorKey: 'intakes.folder.duplicate', params: { name, id: clash.id } }
  return { ...draft, newFolders: upsert(folders, { ...folder, name }) }
}

/** The draft without the folder; `intakes.folder.notEmpty` while a draft folder or a new item is in it. */
export function withoutNewFolder(draft: IntakeDraftContent, id: Id): IntakeDraftContent | DraftError {
  if ((draft.newFolders ?? []).some((f) => f.parentId === id) || draft.newItems.some((n) => n.folderId === id)) {
    return { errorKey: 'intakes.folder.notEmpty' }
  }
  return { ...draft, newFolders: (draft.newFolders ?? []).filter((f) => f.id !== id) }
}

/** The draft with the attribute put in (in its place when it is there already), or what to fix: a bad name or kind or a
 *  unit that is too long (`intakes.attribute.invalid`), a name an attribute has already (`intakes.attribute.duplicate`,
 *  params `name` and the existing attribute's `id`). */
export function withNewAttribute(draft: IntakeDraftContent, s: InventorySnapshot, attribute: DraftNewAttribute): IntakeDraftContent | DraftError {
  const name = attribute.name.trim()
  const bad = nameError(name)
  if (bad) return bad
  if (!KINDS.includes(attribute.kind) || (attribute.kind === 'number' && attribute.unit.trim().length > MAX_ATTRIBUTE_UNIT_LENGTH)) {
    return { errorKey: 'intakes.attribute.invalid' }
  }
  const clash = nameClash(s, draft, { kind: 'attribute', name }, attribute.id)
  if (clash) return { errorKey: 'intakes.attribute.duplicate', params: { name, id: clash.id } }
  return { ...draft, newAttributes: upsert(draft.newAttributes ?? [], { ...attribute, name }) }
}

/** The draft without the attribute; `intakes.attribute.inUse` while a new item uses it. */
export function withoutNewAttribute(draft: IntakeDraftContent, id: Id): IntakeDraftContent | DraftError {
  if (draft.newItems.some((n) => n.attributes.some((a) => a.attributeId === id))) return { errorKey: 'intakes.attribute.inUse' }
  return { ...draft, newAttributes: (draft.newAttributes ?? []).filter((a) => a.id !== id) }
}

/** The draft with the new item put in (in its place when it is there already). It lives on its own, with no line. An
 *  item with a photo gets the photo's id here, once, so a retried commit makes the photo once. */
export function withNewItem(draft: IntakeDraftContent, item: DraftNewItem): IntakeDraftContent {
  const named = item.name.trim() === item.name ? item : { ...item, name: item.name.trim() }
  const placed = named.photo && !named.photoId ? { ...named, photoId: newId() } : named
  const upserted = pruneNewItems({ ...draft, newItems: upsert(draft.newItems, placed) })
  return upserted
}

/** What Undo of withoutNewItem puts back. */
export interface RemovedNewItem {
  item: DraftNewItem
  index: number
  lines: { line: DraftLine; index: number }[]
  newTags: DraftNewTag[]
}

/** The draft without the new item and its lines, and what Undo puts back. Nothing removed when it is not there. */
export function withoutNewItem(draft: IntakeDraftContent, id: Id): { content: IntakeDraftContent; removed: RemovedNewItem | null } {
  const index = draft.newItems.findIndex((n) => n.id === id)
  if (index < 0) return { content: draft, removed: null }
  const lines = draft.lines.flatMap((line, i) => (line.itemId === id ? [{ line, index: i }] : []))
  const content = pruneNewItems({ ...draft, newItems: draft.newItems.filter((n) => n.id !== id), lines: draft.lines.filter((l) => l.itemId !== id) })
  const newTags = (draft.newTags ?? []).filter((t) => !(content.newTags ?? []).some((u) => u.id === t.id))
  return { content, removed: { item: draft.newItems[index]!, index, lines, newTags } }
}

/** Undo of withoutNewItem: the item, its lines and its new tags back in their places. */
export function restoreNewItem(draft: IntakeDraftContent, removed: RemovedNewItem): IntakeDraftContent {
  if (draft.newItems.some((n) => n.id === removed.item.id)) return draft
  const newItems = [...draft.newItems]
  newItems.splice(Math.min(removed.index, newItems.length), 0, removed.item)
  const lines = [...draft.lines]
  for (const { line, index } of removed.lines) if (!lines.some((l) => l.id === line.id)) lines.splice(Math.min(index, lines.length), 0, line)
  const newTags = [...(draft.newTags ?? []), ...removed.newTags.filter((t) => !(draft.newTags ?? []).some((u) => u.id === t.id))]
  return { ...draft, newItems, lines, ...(newTags.length > 0 || draft.newTags ? { newTags } : {}) }
}

/** "Use existing" (§4): every reference to the draft folder or attribute `draftId` goes to the existing `existingId`
 *  (children of a folder, the folder of new items; the attribute of new items and of the values on lines), and the
 *  draft entity goes. A new item or line that would hold the attribute twice keeps the first. Unchanged when `draftId`
 *  is no draft folder or attribute. */
export function useExisting(draft: IntakeDraftContent, draftId: Id, existingId: Id): IntakeDraftContent {
  if ((draft.newFolders ?? []).some((f) => f.id === draftId)) {
    const to = (id: Id | null) => (id === draftId ? existingId : id)
    return {
      ...draft,
      newFolders: (draft.newFolders ?? []).filter((f) => f.id !== draftId).map((f) => ({ ...f, parentId: to(f.parentId) })),
      newItems: draft.newItems.map((n) => ({ ...n, folderId: to(n.folderId) })),
    }
  }
  if ((draft.newAttributes ?? []).some((a) => a.id === draftId)) {
    const once = <T>(list: T[], key: (x: T) => Id): T[] => list.filter((x, i) => list.findIndex((y) => key(y) === key(x)) === i)
    const to = (id: Id) => (id === draftId ? existingId : id)
    return {
      ...draft,
      newAttributes: (draft.newAttributes ?? []).filter((a) => a.id !== draftId),
      newItems: draft.newItems.map((n) => ({
        ...n,
        attributes: once(n.attributes.map((a) => ({ ...a, attributeId: to(a.attributeId) })), (a) => a.attributeId),
      })),
      lines: draft.lines.map((l) => ({ ...l, axisValues: once(l.axisValues.map((v) => ({ ...v, attributeId: to(v.attributeId) })), (v) => v.attributeId) })),
    }
  }
  return draft
}
