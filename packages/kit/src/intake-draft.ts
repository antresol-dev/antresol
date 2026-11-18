import {
  customUnitKey,
  folderArchived,
  folderTwin,
  intakeUnits,
  isColorHex,
  itemTwin,
  MAX_ATTRIBUTE_UNIT_LENGTH,
  MAX_NAME_LENGTH,
  newId,
  pruneDraft,
  resolveUnit,
  sameName as same,
  SI_PREFIXES,
  unitTwin,
  type DraftLine,
  type DraftNewAttribute,
  type DraftNewFolder,
  type DraftNewItem,
  type DraftNewTag,
  type DraftNewUnit,
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

/** What already has this name: a folder under the same parent (living ones first, then the draft's, then an archived
 *  one), an item of the same folder (same order; archived ones count), an attribute anywhere, a unit (built-in, custom
 *  or the draft's: name without case, symbol with case). `draft`: the clash is with a draft entity. `archived`: the
 *  twin is in the archive. For a unit that is not the draft's, `id` is its key ('m', 'custom:<id>'), as in core.
 *  `exceptId`: the entity being edited, which does not clash with itself. */
export function nameClash(
  s: InventorySnapshot,
  draft: IntakeDraftContent,
  q:
    | { kind: 'folder'; name: string; parentId: Id | null }
    | { kind: 'item'; name: string; folderId: Id | null }
    | { kind: 'attribute'; name: string }
    | { kind: 'unit'; name: string; symbol: string },
  exceptId?: Id,
): { id: Id; draft: boolean; archived?: true } | null {
  const hit = (twin: { id: Id; archivedAt: string | null } | undefined, own: { id: Id } | undefined) => {
    if (twin && twin.archivedAt === null) return { id: twin.id, draft: false }
    if (own) return { id: own.id, draft: true }
    return twin ? { id: twin.id, draft: false, archived: true as const } : null
  }
  if (q.kind === 'folder') {
    const own = (draft.newFolders ?? []).find((f) => f.id !== exceptId && f.parentId === q.parentId && same(f.name, q.name))
    return hit(folderTwin(s, q.parentId, q.name, exceptId), own)
  }
  if (q.kind === 'item') {
    const own = draft.newItems.find((n) => n.id !== exceptId && n.folderId === q.folderId && same(n.name, q.name))
    return hit(itemTwin(s, q.folderId, q.name, exceptId), own)
  }
  if (q.kind === 'unit') {
    const twin = unitTwin(s, { name: q.name, symbol: q.symbol }, exceptId)
    if (twin) return { id: twin.key, draft: false }
    const own = (draft.newUnits ?? []).find((u) => u.id !== exceptId && (same(u.name, q.name) || u.symbol.trim() === q.symbol.trim()))
    return own ? { id: own.id, draft: true } : null
  }
  const existing = s.attributes.find((a) => a.id !== exceptId && same(a.name, q.name))
  if (existing) return { id: existing.id, draft: false }
  const own = (draft.newAttributes ?? []).find((a) => a.id !== exceptId && same(a.name, q.name))
  return own ? { id: own.id, draft: true } : null
}

/** A name that is empty or too long, as the draft reports it; null when it is fine. */
export const nameError = (name: string): DraftError | null =>
  name.trim() === ''
    ? { errorKey: 'errors.domain.name_required' }
    : name.trim().length > MAX_NAME_LENGTH
      ? { errorKey: 'errors.domain.name_too_long' }
      : null

/** The draft with the folder put in (in its place when it is there already), or what to fix: a bad name, a parent that
 *  is the folder itself or one of its descendants (`intakes.folder.cycle`), a parent that is gone
 *  (`intakes.folder.parentGone`), a name the parent already has (`intakes.folder.duplicate`, params `name` and the
 *  existing folder's `id`; `intakes.folder.duplicateArchived` when an archived folder has it). */
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
  if (clash) return { errorKey: clash.archived ? 'intakes.folder.duplicateArchived' : 'intakes.folder.duplicate', params: { name, id: clash.id } }
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

/** The draft as an open form sees it: its own attributes and the ones the form made and holds, not written yet. */
export function withHeldAttributes(draft: IntakeDraftContent, held: readonly DraftNewAttribute[]): IntakeDraftContent {
  const fresh = held.filter((a) => !(draft.newAttributes ?? []).some((x) => x.id === a.id))
  return fresh.length === 0 ? draft : { ...draft, newAttributes: [...(draft.newAttributes ?? []), ...fresh] }
}

/** The draft with the held attributes that something `uses` written, in the order they were made; or what to fix. A held
 *  attribute nothing uses is dropped: it was made for a form that did not keep it. */
export function writeHeldAttributes(draft: IntakeDraftContent, s: InventorySnapshot, held: readonly DraftNewAttribute[], uses: ReadonlySet<Id>): IntakeDraftContent | DraftError {
  let out = draft
  for (const a of held) {
    if (!uses.has(a.id)) continue
    const r = withNewAttribute(out, s, a)
    if ('errorKey' in r) return r
    out = r
  }
  return out
}

/** The draft without the attribute; `intakes.attribute.inUse` while a new item uses it. */
export function withoutNewAttribute(draft: IntakeDraftContent, id: Id): IntakeDraftContent | DraftError {
  if (draft.newItems.some((n) => n.attributes.some((a) => a.attributeId === id))) return { errorKey: 'intakes.attribute.inUse' }
  return { ...draft, newAttributes: (draft.newAttributes ?? []).filter((a) => a.id !== id) }
}

/** The draft with the new item put in (in its place when it is there already). It lives on its own, with no line. An
 *  item's photo without an id gets one here, once, so a retried commit makes the photo once. */
export function withNewItem(draft: IntakeDraftContent, item: DraftNewItem): IntakeDraftContent {
  const named = item.name.trim() === item.name ? item : { ...item, name: item.name.trim() }
  const placed = named.photos?.some((p) => !p.id) ? { ...named, photos: named.photos.map((p) => (p.id ? p : { ...p, id: newId() })) } : named
  return pruneDraft({ ...draft, newItems: upsert(draft.newItems, placed) })
}

/** What Undo of withoutNewItem puts back. The parts pruned with the item (`newTags`, and when there were any
 *  `newAttributes`, `newUnits`, `addedOptions`) come back with it. */
export interface RemovedNewItem {
  item: DraftNewItem
  index: number
  lines: { line: DraftLine; index: number }[]
  newTags: DraftNewTag[]
  newAttributes?: DraftNewAttribute[]
  newUnits?: DraftNewUnit[]
  addedOptions?: AddedOptions
}
type AddedOptions = NonNullable<IntakeDraftContent['addedOptions']>

/** What `after` lost of `before`: the parts pruneDraft dropped. */
export function prunedParts(before: IntakeDraftContent, after: IntakeDraftContent): Pick<RemovedNewItem, 'newTags' | 'newAttributes' | 'newUnits' | 'addedOptions'> {
  const gone = <T extends { id: Id }>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] => (a ?? []).filter((x) => !(b ?? []).some((y) => y.id === x.id))
  const options: AddedOptions = (before.addedOptions ?? []).flatMap((o) => {
    const kept = after.addedOptions?.find((x) => x.attributeId === o.attributeId)?.values ?? []
    const lost = o.values.filter((v) => !kept.includes(v))
    return lost.length > 0 ? [{ attributeId: o.attributeId, values: lost }] : []
  })
  return { newTags: gone(before.newTags, after.newTags), newAttributes: gone(before.newAttributes, after.newAttributes), newUnits: gone(before.newUnits, after.newUnits), addedOptions: options }
}

/** The draft with the parts put back (those it has already are not doubled); fields it lacked stay absent when there is
 *  nothing to put in them. */
export function restoredParts(draft: IntakeDraftContent, parts: Partial<Pick<RemovedNewItem, 'newTags' | 'newAttributes' | 'newUnits' | 'addedOptions'>>): IntakeDraftContent {
  const out: IntakeDraftContent = { ...draft }
  const add = <T extends { id: Id }>(have: T[] | undefined, back: T[] | undefined): T[] | undefined =>
    (back ?? []).length === 0 ? have : [...(have ?? []), ...(back ?? []).filter((x) => !(have ?? []).some((y) => y.id === x.id))]
  const tags = add(draft.newTags, parts.newTags)
  if (tags) out.newTags = tags
  const attributes = add(draft.newAttributes, parts.newAttributes)
  if (attributes) out.newAttributes = attributes
  const units = add(draft.newUnits, parts.newUnits)
  if (units) out.newUnits = units
  if ((parts.addedOptions ?? []).length > 0) {
    const merged = [...(draft.addedOptions ?? []).map((o) => ({ ...o, values: [...o.values] }))]
    for (const o of parts.addedOptions!) {
      const at = merged.find((x) => x.attributeId === o.attributeId)
      if (at) at.values.push(...o.values.filter((v) => !at.values.some((w) => same(w, v))))
      else merged.push({ attributeId: o.attributeId, values: [...o.values] })
    }
    out.addedOptions = merged
  }
  return out
}

/** The draft without the new item and its lines, and what Undo puts back. Nothing removed when it is not there. */
export function withoutNewItem(draft: IntakeDraftContent, id: Id): { content: IntakeDraftContent; removed: RemovedNewItem | null } {
  const index = draft.newItems.findIndex((n) => n.id === id)
  if (index < 0) return { content: draft, removed: null }
  const lines = draft.lines.flatMap((line, i) => (line.itemId === id ? [{ line, index: i }] : []))
  const content = pruneDraft({ ...draft, newItems: draft.newItems.filter((n) => n.id !== id), lines: draft.lines.filter((l) => l.itemId !== id) })
  return { content, removed: { item: draft.newItems[index]!, index, lines, ...prunedParts(draft, content) } }
}

/** Undo of withoutNewItem: the item, its lines and the parts pruned with it back in their places. */
export function restoreNewItem(draft: IntakeDraftContent, removed: RemovedNewItem): IntakeDraftContent {
  if (draft.newItems.some((n) => n.id === removed.item.id)) return draft
  const newItems = [...draft.newItems]
  newItems.splice(Math.min(removed.index, newItems.length), 0, removed.item)
  const lines = [...draft.lines]
  for (const { line, index } of removed.lines) if (!lines.some((l) => l.id === line.id)) lines.splice(Math.min(index, lines.length), 0, line)
  return restoredParts({ ...draft, newItems, lines }, removed)
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

/** The new item `itemId` of the draft and its place, or the error: only a new item takes declarations; an existing
 *  item's attributes, tags and unit are changed in the inventory, not by an intake. */
const newItemOf = (draft: IntakeDraftContent, itemId: Id): DraftNewItem | DraftError =>
  draft.newItems.find((n) => n.id === itemId) ?? { errorKey: 'intakes.item.notInDraft' }
const failedDraft = (x: unknown): x is DraftError => typeof x === 'object' && x !== null && 'errorKey' in x
const replaceItem = (draft: IntakeDraftContent, item: DraftNewItem): IntakeDraftContent => ({ ...draft, newItems: upsert(draft.newItems, item) })

/** A new attribute declared under an item, as `withNewAttribute` takes it. */
export type ItemAttributeDef = DraftNewAttribute

/** The attribute `def` (declared here, or an existing one by id, or a draft attribute by id) put under the new item
 *  `itemId`: at the end of its attributes, or in its place when it has it. `placement`: `axis` (default false: shared)
 *  and the shared `value` (default none). Errors: `intakes.item.notInDraft`, `intakes.attribute.unknown`, those of
 *  `withNewAttribute` (a bad name, `intakes.attribute.invalid`, `intakes.attribute.duplicate` with the existing `id`). */
export function withItemAttribute(
  draft: IntakeDraftContent,
  s: InventorySnapshot,
  itemId: Id,
  def: ItemAttributeDef | Id,
  placement: { axis?: boolean; value?: string | null } = {},
): IntakeDraftContent | DraftError {
  const item = newItemOf(draft, itemId)
  if (failedDraft(item)) return item
  let out = draft
  let attributeId: Id
  if (typeof def === 'string') {
    if (!s.attributes.some((a) => a.id === def) && !(draft.newAttributes ?? []).some((a) => a.id === def)) return { errorKey: 'intakes.attribute.unknown' }
    attributeId = def
  } else {
    const r = withNewAttribute(draft, s, def)
    if (failedDraft(r)) return r
    out = r
    attributeId = def.id
  }
  const had = item.attributes.find((a) => a.attributeId === attributeId)
  const axis = placement.axis ?? had?.axis ?? false
  const entry = { attributeId, value: axis ? null : placement.value !== undefined ? placement.value?.trim() || null : (had?.value ?? null), axis }
  const attributes = item.attributes.some((a) => a.attributeId === attributeId)
    ? item.attributes.map((a) => (a.attributeId === attributeId ? entry : a))
    : [...item.attributes, entry]
  return pruneDraft(replaceItem(out, { ...item, attributes }))
}

/** The tag put on the new item `itemId`. `tag` is the id of an existing or draft tag, or a name: a tag of the
 *  inventory or of the draft with that name (no case) is used (its colour stays), otherwise a new draft tag with the
 *  optional `color` (#RRGGBB) is declared. Errors: `intakes.item.notInDraft`, a bad name, `intakes.tag.invalidColor`. */
export function withItemTag(draft: IntakeDraftContent, s: InventorySnapshot, itemId: Id, tag: string, color?: string | null): IntakeDraftContent | DraftError {
  const item = newItemOf(draft, itemId)
  if (failedDraft(item)) return item
  let out = draft
  let tagId: Id | undefined = s.tags.find((t) => t.id === tag)?.id ?? (draft.newTags ?? []).find((t) => t.id === tag)?.id
  if (tagId === undefined) {
    const name = tag.trim()
    const bad = nameError(name)
    if (bad) return bad
    tagId = s.tags.find((t) => same(t.name, name))?.id ?? (draft.newTags ?? []).find((t) => same(t.name, name))?.id
    if (tagId === undefined) {
      if (color != null && !isColorHex(color.toUpperCase())) return { errorKey: 'intakes.tag.invalidColor' }
      tagId = newId()
      out = { ...out, newTags: [...(out.newTags ?? []), { id: tagId, name, ...(color != null ? { color } : {}) }] }
    }
  }
  const tagIds = item.tagIds?.includes(tagId) ? item.tagIds : [...(item.tagIds ?? []), tagId]
  return pruneDraft(replaceItem(out, { ...item, tagIds }))
}

/** The unit of the new item `itemId`: a unit key ('m', 'custom:<id>', a draft unit's key), or a unit declared here. A
 *  declared unit may not take the name (no case) or the symbol (with case) of a built-in, a custom or an earlier draft
 *  unit: `intakes.unit.duplicate` with the name and the other's `id` (a key for units of the inventory). Errors:
 *  `intakes.item.notInDraft`, `intakes.unit.unknown`, a bad name, `intakes.unit.invalid` (empty or long symbol). */
export function withItemUnit(
  draft: IntakeDraftContent,
  s: InventorySnapshot,
  itemId: Id,
  unit: Omit<DraftNewUnit, 'id'> & { id?: Id } | string,
): IntakeDraftContent | DraftError {
  const item = newItemOf(draft, itemId)
  if (failedDraft(item)) return item
  if (typeof unit === 'string') {
    if (!resolveUnit(unit, intakeUnits(draft, s))) return { errorKey: 'intakes.unit.unknown' }
    return pruneDraft(replaceItem(draft, { ...item, unitKey: unit }))
  }
  const name = unit.name.trim()
  const symbol = unit.symbol.trim()
  const bad = nameError(name)
  if (bad) return bad
  if (symbol === '') return { errorKey: 'intakes.unit.invalid' }
  if (symbol.length > MAX_NAME_LENGTH) return { errorKey: 'intakes.unit.symbolTooLong' }
  if (unit.prefixPowers.some((x) => !Number.isInteger(x) || !Object.hasOwn(SI_PREFIXES, x))) return { errorKey: 'intakes.unit.invalid' }
  // The same unit declared again without an id is the one the draft has.
  const again = unit.id === undefined ? (draft.newUnits ?? []).find((u) => same(u.name, name) && u.symbol.trim() === symbol) : undefined
  const id = unit.id ?? again?.id ?? newId()
  const clash = nameClash(s, draft, { kind: 'unit', name, symbol }, id)
  if (clash) return { errorKey: 'intakes.unit.duplicate', params: { name, id: clash.id } }
  const declared: DraftNewUnit = { id, name, symbol, prefixPowers: [...unit.prefixPowers] }
  return pruneDraft(replaceItem({ ...draft, newUnits: upsert(draft.newUnits ?? [], declared) }, { ...item, unitKey: customUnitKey(id) }))
}

/** A value added to an existing list attribute (appended on commit; any line of any item may use it). Everything else
 *  unused is pruned first, then the value is kept for the line that is about to use it: it goes at the next prune
 *  that finds no line using it. Already in the draft's values (no case): the draft as it is. Errors:
 *  `intakes.attribute.unknown` (not an attribute of the inventory), `intakes.option.notList`, a bad value,
 *  `intakes.option.exists` (the list has it, no case; param `value`). */
export function withAddedOption(draft: IntakeDraftContent, s: InventorySnapshot, attributeId: Id, value: string): IntakeDraftContent | DraftError {
  const attribute = s.attributes.find((a) => a.id === attributeId)
  if (!attribute) return { errorKey: 'intakes.attribute.unknown' }
  if (attribute.kind !== 'enum') return { errorKey: 'intakes.option.notList' }
  const v = value.trim()
  const bad = nameError(v)
  if (bad) return bad
  if (attribute.options.some((o) => same(o, v))) return { errorKey: 'intakes.option.exists', params: { value: v } }
  // Everything else unused goes; the values staged so far stay for the lines about to use them.
  const kept = { ...pruneDraft(draft), ...(draft.addedOptions ? { addedOptions: draft.addedOptions } : {}) }
  const entries = kept.addedOptions ?? []
  const at = entries.find((o) => o.attributeId === attributeId)
  if (at?.values.some((w) => same(w, v))) return kept
  const addedOptions = at
    ? entries.map((o) => (o === at ? { ...o, values: [...o.values, v] } : o))
    : [...entries, { attributeId, values: [v] }]
  return { ...kept, addedOptions }
}
