import { folderArchived, itemArchived, sameName, type Id, type IntakeDraftContent, type InventorySnapshot } from '@antresol/core'
import { similarNames, unitChoices, type SimilarName } from '@antresol/kit'
import { draftFolderPath } from './shape'

/** Names that look like a new name, for the assistant to check before it goes on (spec 2026-11-17 §5): advice only. */
export interface SimilarNear extends SimilarName {
  /** An item in the folder the new item goes in (`why: 'same'` is then impossible: that is a refusal). */
  sameFolder?: true
  archived?: true
  /** It is a part of this draft, not of the stock. */
  draft?: true
}
export interface SimilarEntry {
  kind: 'item' | 'folder' | 'attribute' | 'tag' | 'unit' | 'value'
  name: string
  near: SimilarNear[]
}

interface Candidate {
  id: Id
  name: string
  where?: string
  sameFolder?: true
  archived?: true
  draft?: true
}

function near(candidates: Candidate[], name: string): SimilarNear[] {
  const key = (x: { id: Id; name: string }) => `${x.id}\u0000${x.name}`
  const byKey = new Map(candidates.map((c) => [key(c), c] as const))
  return similarNames(candidates, name).map((n) => {
    const c = byKey.get(key(n))!
    return { ...n, ...(c.sameFolder ? { sameFolder: true as const } : {}), ...(c.archived ? { archived: true as const } : {}), ...(c.draft ? { draft: true as const } : {}) }
  })
}

const placeOf = (s: InventorySnapshot, draft: IntakeDraftContent, folderId: Id | null): string => draftFolderPath(s, draft, folderId) || 'root'
const changed = <T extends { id: Id }>(before: readonly T[] | undefined, after: readonly T[] | undefined, differs: (a: T, b: T) => boolean = () => false): T[] =>
  (after ?? []).filter((x) => {
    const was = (before ?? []).find((y) => y.id === x.id)
    return !was || differs(was, x)
  })

/**
 * `similar` for every name `after` has that `before` did not: new items and folders (or renamed ones), attributes, tags,
 * units and values added to lists. Items are compared with every item of the inventory (the ones of the same folder
 * marked, archived ones too) and with the other new items; an item of the same folder with the same name never gets
 * here (it is refused). A name with nothing like it still has its entry, with an empty list.
 */
export function similarOf(s: InventorySnapshot, before: IntakeDraftContent, after: IntakeDraftContent): SimilarEntry[] {
  const out: SimilarEntry[] = []
  for (const item of changed(before.newItems, after.newItems, (a, b) => a.name !== b.name || a.folderId !== b.folderId)) {
    const candidates: Candidate[] = [
      ...s.items
        .filter((i) => !(i.folderId === item.folderId && sameName(i.name, item.name)))
        .map((i): Candidate => ({ id: i.id, name: i.name, where: placeOf(s, after, i.folderId), ...(i.folderId === item.folderId ? { sameFolder: true as const } : {}), ...(itemArchived(s, i) ? { archived: true as const } : {}) })),
      ...after.newItems
        .filter((n) => n.id !== item.id && !(n.folderId === item.folderId && sameName(n.name, item.name)))
        .map((n): Candidate => ({ id: n.id, name: n.name, where: placeOf(s, after, n.folderId), draft: true, ...(n.folderId === item.folderId ? { sameFolder: true as const } : {}) })),
    ]
    out.push({ kind: 'item', name: item.name, near: near(candidates, item.name) })
  }
  for (const folder of changed(before.newFolders, after.newFolders, (a, b) => a.name !== b.name || a.parentId !== b.parentId)) {
    const candidates: Candidate[] = [
      ...s.folders
        .filter((f) => !(f.parentId === folder.parentId && sameName(f.name, folder.name)))
        .map((f): Candidate => ({ id: f.id, name: f.name, where: draftFolderPath(s, after, f.id), ...(folderArchived(s, f.id) ? { archived: true as const } : {}) })),
      ...(after.newFolders ?? [])
        .filter((f) => f.id !== folder.id && !(f.parentId === folder.parentId && sameName(f.name, folder.name)))
        .map((f): Candidate => ({ id: f.id, name: f.name, where: draftFolderPath(s, after, f.id), draft: true })),
    ]
    out.push({ kind: 'folder', name: folder.name, near: near(candidates, folder.name) })
  }
  for (const a of changed(before.newAttributes, after.newAttributes, (x, y) => x.name !== y.name)) {
    const candidates: Candidate[] = [
      ...s.attributes.map((x): Candidate => ({ id: x.id, name: x.name })),
      ...(after.newAttributes ?? []).filter((x) => x.id !== a.id).map((x): Candidate => ({ id: x.id, name: x.name, draft: true })),
    ]
    out.push({ kind: 'attribute', name: a.name, near: near(candidates, a.name) })
  }
  for (const t of changed(before.newTags, after.newTags, (x, y) => x.name !== y.name)) {
    const candidates: Candidate[] = [
      ...s.tags.map((x): Candidate => ({ id: x.id, name: x.name })),
      ...(after.newTags ?? []).filter((x) => x.id !== t.id).map((x): Candidate => ({ id: x.id, name: x.name, draft: true })),
    ]
    out.push({ kind: 'tag', name: t.name, near: near(candidates, t.name) })
  }
  for (const u of changed(before.newUnits, after.newUnits, (x, y) => x.name !== y.name)) {
    const candidates: Candidate[] = [
      ...unitChoices(s).map((x): Candidate => ({ id: x.key, name: x.name })),
      ...(after.newUnits ?? []).filter((x) => x.id !== u.id).map((x): Candidate => ({ id: x.id, name: x.name, draft: true })),
    ]
    out.push({ kind: 'unit', name: u.name, near: near(candidates, u.name) })
  }
  for (const o of after.addedOptions ?? []) {
    const attribute = s.attributes.find((a) => a.id === o.attributeId)
    if (!attribute) continue
    const had = before.addedOptions?.find((x) => x.attributeId === o.attributeId)?.values ?? []
    for (const value of o.values.filter((v) => !had.some((h) => sameName(h, v)))) {
      const candidates: Candidate[] = [
        ...attribute.options.map((x): Candidate => ({ id: attribute.id, name: x, where: attribute.name })),
        ...o.values.filter((x) => !sameName(x, value)).map((x): Candidate => ({ id: attribute.id, name: x, where: attribute.name, draft: true })),
      ]
      out.push({ kind: 'value', name: value, near: near(candidates, value) })
    }
  }
  return out
}
