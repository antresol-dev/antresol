import {
  customUnitKey,
  MAX_DRAFT_ITEM_PHOTOS,
  newId,
  type DraftItemPhoto,
  type PhotoFile,
  intakeUnits,
  itemArchived,
  pruneDraft,
  sameName,
  unitClash,
  type DraftNewUnit,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
  type UnitDef,
} from '@antresol/core'
import { folderPathWithDraft } from '@antresol/kit/draft-folders'
import { unitChoices } from '@antresol/kit/amounts'
import { nameClash, nameError, type DraftError } from '@antresol/kit/intake-draft'
import { similarNames, type SimilarName } from '@antresol/kit/similar-names'

// The parts an intake declares under its items (spec 2026-11-17 intake entities §6): units and list values a line sheet
// holds until the line is saved, the "Remove from all items" of the "Will be created" blocks, and the near-duplicate
// candidates the forms show. Pure: each returns a new draft, or what to fix.

/** A value added to an existing list attribute, held by a form until its line is saved. */
export interface HeldOption {
  attributeId: Id
  value: string
}

const upsert = <T extends { id: Id }>(list: readonly T[], x: T): T[] =>
  list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]

/** The draft as an open form sees it: its own units and the ones the form made and holds. */
export function withHeldUnits(draft: IntakeDraftContent, held: readonly DraftNewUnit[]): IntakeDraftContent {
  const fresh = held.filter((u) => !(draft.newUnits ?? []).some((x) => x.id === u.id))
  return fresh.length === 0 ? draft : { ...draft, newUnits: [...(draft.newUnits ?? []), ...fresh] }
}

/** The draft with the held units that something `uses` (by unit key) written; or what to fix. A held unit nothing uses
 *  is dropped: it was made for a form that did not keep it. */
export function writeHeldUnits(draft: IntakeDraftContent, s: InventorySnapshot, held: readonly DraftNewUnit[], uses: ReadonlySet<string>): IntakeDraftContent | DraftError {
  let out = draft
  for (const u of held) {
    if (!uses.has(customUnitKey(u.id))) continue
    const clash = nameClash(s, out, { kind: 'unit', name: u.name, symbol: u.symbol }, u.id)
    if (clash) return { errorKey: 'intakes.unit.duplicate', params: { name: u.name, id: clash.id } }
    out = { ...out, newUnits: upsert(out.newUnits ?? [], u) }
  }
  return out
}

/** The draft as an open form sees it: its own added values and the ones the form holds. */
export function withHeldOptions(draft: IntakeDraftContent, held: readonly HeldOption[]): IntakeDraftContent {
  let out = draft
  for (const h of held) out = withStagedOption(out, h.attributeId, h.value)
  return out
}

/** The draft with the value staged for the list (nothing when the draft stages it already, no case). */
export function withStagedOption(draft: IntakeDraftContent, attributeId: Id, value: string): IntakeDraftContent {
  const v = value.trim()
  const entries = draft.addedOptions ?? []
  const at = entries.find((o) => o.attributeId === attributeId)
  if (at?.values.some((w) => sameName(w, v))) return draft
  return {
    ...draft,
    addedOptions: at ? entries.map((o) => (o === at ? { ...o, values: [...o.values, v] } : o)) : [...entries, { attributeId, values: [v] }],
  }
}

/** The draft with the held values written next to what the line writes (the line's prune keeps those it uses). A value
 *  the list has meanwhile is skipped. */
export function writeHeldOptions(draft: IntakeDraftContent, s: InventorySnapshot, held: readonly HeldOption[]): IntakeDraftContent | DraftError {
  let out = draft
  for (const h of held) {
    const attribute = s.attributes.find((a) => a.id === h.attributeId)
    if (!attribute) return { errorKey: 'intakes.attribute.unknown' }
    if (attribute.kind !== 'enum') return { errorKey: 'intakes.option.notList' }
    const bad = nameError(h.value)
    if (bad) return bad
    if (attribute.options.some((o) => sameName(o, h.value))) continue
    out = withStagedOption(out, h.attributeId, h.value)
  }
  return out
}

/** Whether `value` is in the list now: the attribute's own options, the draft's staged values or the held ones. */
export function listHas(options: readonly string[], draft: IntakeDraftContent, attributeId: Id, value: string): boolean {
  return (
    options.some((o) => sameName(o, value)) ||
    (draft.addedOptions ?? []).some((o) => o.attributeId === attributeId && o.values.some((w) => sameName(w, value)))
  )
}

// ---- "Remove from all items" ----

/** Every new item that counts in the unit goes back to pieces; the unit goes with them. */
export function withoutUnitEverywhere(draft: IntakeDraftContent, unitId: Id): IntakeDraftContent {
  const key = customUnitKey(unitId)
  return pruneDraft({
    ...draft,
    newItems: draft.newItems.map((n) => (n.unitKey === key ? { ...n, unitKey: 'pcs' } : n)),
    newUnits: (draft.newUnits ?? []).filter((u) => u.id !== unitId),
  })
}

/** The draft attribute off every new item (and its values off the lines); it goes with them. */
export function withoutAttributeEverywhere(draft: IntakeDraftContent, attributeId: Id): IntakeDraftContent {
  return pruneDraft({
    ...draft,
    newItems: draft.newItems.map((n) => ({ ...n, attributes: n.attributes.filter((x) => x.attributeId !== attributeId) })),
    lines: draft.lines.map((l) => ({ ...l, axisValues: l.axisValues.filter((v) => v.attributeId !== attributeId) })),
  })
}

/** The draft tag off every new item; it goes with them. */
export function withoutTagEverywhere(draft: IntakeDraftContent, tagId: Id): IntakeDraftContent {
  return pruneDraft({ ...draft, newItems: draft.newItems.map((n) => (n.tagIds?.includes(tagId) ? { ...n, tagIds: n.tagIds.filter((x) => x !== tagId) } : n)) })
}

/** The staged list value goes, the lines that use it go with it (a line without its value would not read) and new items
 *  that hold it as a shared value lose that value. */
export function withoutAddedValue(draft: IntakeDraftContent, attributeId: Id, value: string): IntakeDraftContent {
  const uses = (l: IntakeDraftContent['lines'][number]) => l.axisValues.some((v) => v.attributeId === attributeId && sameName(v.value, value))
  const newItems = draft.newItems.map((n) =>
    n.attributes.some((x) => x.attributeId === attributeId && x.value !== null && sameName(x.value, value))
      ? { ...n, attributes: n.attributes.map((x) => (x.attributeId === attributeId && x.value !== null && sameName(x.value, value) ? { ...x, value: null } : x)) }
      : n,
  )
  const entries = (draft.addedOptions ?? [])
    .map((o) => (o.attributeId === attributeId ? { ...o, values: o.values.filter((w) => !sameName(w, value)) } : o))
    .filter((o) => o.values.length > 0)
  return pruneDraft({ ...draft, newItems, lines: draft.lines.filter((l) => !uses(l)), ...(draft.addedOptions ? { addedOptions: entries } : {}) })
}

/** How many new items `withoutAddedValue` takes the value off (shared value). */
export function itemsUsingValue(draft: IntakeDraftContent, attributeId: Id, value: string): number {
  return draft.newItems.filter((n) => n.attributes.some((x) => x.attributeId === attributeId && x.value !== null && sameName(x.value, value))).length
}

/** How many lines `withoutAttributeEverywhere` loses a variant value of: the lines of the new items that vary by it. */
export function linesUsingAttribute(draft: IntakeDraftContent, attributeId: Id): number {
  return draft.lines.filter((l) => l.axisValues.some((v) => v.attributeId === attributeId)).length
}

/** How many lines `withoutAddedValue` removes. */
export function linesUsingValue(draft: IntakeDraftContent, attributeId: Id, value: string): number {
  return draft.lines.filter((l) => l.axisValues.some((v) => v.attributeId === attributeId && sameName(v.value, value))).length
}

/** A staged value renamed, on the lines and the new items that use it too; or what to fix. */
export function withRenamedAddedValue(draft: IntakeDraftContent, s: InventorySnapshot, attributeId: Id, from: string, to: string): IntakeDraftContent | DraftError {
  const attribute = s.attributes.find((a) => a.id === attributeId)
  const v = to.trim()
  if (!attribute || attribute.kind !== 'enum') return { errorKey: 'intakes.option.notList' }
  const bad = nameError(v)
  if (bad) return bad
  const others = (draft.addedOptions ?? []).find((o) => o.attributeId === attributeId)?.values.filter((w) => !sameName(w, from)) ?? []
  if (attribute.options.some((o) => sameName(o, v)) || others.some((w) => sameName(w, v))) return { errorKey: 'intakes.option.exists', params: { value: v } }
  const swap = (x: string): string => (sameName(x, from) ? v : x)
  return {
    ...draft,
    addedOptions: (draft.addedOptions ?? []).map((o) => (o.attributeId === attributeId ? { ...o, values: o.values.map(swap) } : o)),
    lines: draft.lines.map((l) => ({ ...l, axisValues: l.axisValues.map((x) => (x.attributeId === attributeId ? { ...x, value: swap(x.value) } : x)) })),
    newItems: draft.newItems.map((n) => ({ ...n, attributes: n.attributes.map((x) => (x.attributeId === attributeId && x.value ? { ...x, value: swap(x.value) } : x)) })),
  }
}

/** A draft tag renamed and recoloured (null: no colour); or what to fix. The name may not be a tag's already. */
export function withEditedTag(draft: IntakeDraftContent, s: InventorySnapshot, tagId: Id, edit: { name: string; color: string | null }): IntakeDraftContent | DraftError {
  const name = edit.name.trim()
  const bad = nameError(name)
  if (bad) return bad
  if (s.tags.some((t) => sameName(t.name, name)) || (draft.newTags ?? []).some((t) => t.id !== tagId && sameName(t.name, name))) return { errorKey: 'intakes.tag.duplicate', params: { name } }
  return {
    ...draft,
    newTags: (draft.newTags ?? []).map((t) => {
      if (t.id !== tagId) return t
      const { color: _old, ...rest } = t
      return { ...rest, name, ...(edit.color ? { color: edit.color } : {}) }
    }),
  }
}

/** Undo for a change of the whole draft: puts `before` back only while the draft still is `after`, so a later edit is
 *  never lost. */
export function undoTo(before: IntakeDraftContent, after: IntakeDraftContent): (c: IntakeDraftContent) => IntakeDraftContent {
  const mark = JSON.stringify(after)
  return (c) => (JSON.stringify(c) === mark ? before : c)
}

// ---- Units and near duplicates ----

/** The unit choices of a form: the inventory's units and the draft's (a draft unit's key is `customUnitKey(id)`). */
export function unitChoicesWithDraft(s: InventorySnapshot, draft: IntakeDraftContent): UnitDef[] {
  return unitChoices({ ...s, units: intakeUnits(draft, s) })
}

/** Whether a name or a symbol is a unit's already: built-in, the inventory's or another draft unit's (name without case,
 *  symbol with case). `exceptId`: the unit being edited. */
export function unitTaken(s: InventorySnapshot, draft: IntakeDraftContent, part: { name?: string; symbol?: string }, exceptId?: Id): boolean {
  const name = part.name?.trim() ?? ''
  const symbol = part.symbol?.trim() ?? ''
  if (name === '' && symbol === '') return false
  if (unitClash(s, { ...(name ? { name } : {}), ...(symbol ? { symbol } : {}) }, exceptId)) return true
  return (draft.newUnits ?? []).some((u) => u.id !== exceptId && ((name !== '' && sameName(u.name, name)) || (symbol !== '' && u.symbol.trim() === symbol)))
}

/** Existing and draft items that look like a new item's name; those of another folder say where they are. */
export function similarItems(s: InventorySnapshot, draft: IntakeDraftContent, name: string, folderId: Id | null, exceptId?: Id): SimilarName[] {
  const place = (id: Id | null): string | undefined => (id === folderId ? undefined : folderPathWithDraft(s, draft, id).join(' / ') || s.inventory.name)
  return similarNames(
    [
      ...s.items.filter((i) => !itemArchived(s, i)).map((i) => ({ id: i.id, name: i.name, where: place(i.folderId) })),
      ...draft.newItems.filter((n) => n.id !== exceptId).map((n) => ({ id: n.id, name: n.name, where: place(n.folderId) })),
    ].map((c) => (c.where === undefined ? { id: c.id, name: c.name } : c)),
    name,
  )
}

/** Existing and draft folders that look like a new folder's name; those of another parent say where. */
export function similarFolders(s: InventorySnapshot, draft: IntakeDraftContent, name: string, parentId: Id | null, exceptId?: Id): SimilarName[] {
  const where = (id: Id | null): string | undefined => (id === parentId ? undefined : folderPathWithDraft(s, draft, id).join(' / ') || s.inventory.name)
  const list = [
    ...s.folders.filter((f) => f.archivedAt === null).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
    ...(draft.newFolders ?? []).filter((f) => f.id !== exceptId).map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
  ]
  return similarNames(list.map((f) => (where(f.parentId) === undefined ? { id: f.id, name: f.name } : { id: f.id, name: f.name, where: where(f.parentId)! })), name)
}

/** Existing and draft attributes / tags / units that look like a typed name. */
export function similarAttributes(s: InventorySnapshot, draft: IntakeDraftContent, name: string, exceptId?: Id): SimilarName[] {
  return similarNames([...s.attributes, ...(draft.newAttributes ?? [])].filter((a) => a.id !== exceptId).map((a) => ({ id: a.id, name: a.name })), name)
}
export function similarTags(s: InventorySnapshot, draft: IntakeDraftContent, name: string, exceptId?: Id): SimilarName[] {
  return similarNames([...s.tags, ...(draft.newTags ?? [])].filter((t) => t.id !== exceptId).map((t) => ({ id: t.id, name: t.name })), name)
}
export function similarUnits(s: InventorySnapshot, draft: IntakeDraftContent, name: string, exceptId?: Id): SimilarName[] {
  return similarNames(unitChoicesWithDraft(s, draft).filter((u) => u.key !== (exceptId ? customUnitKey(exceptId) : '')).map((u) => ({ id: u.key, name: u.name })), name)
}

// ---- The gallery of a new item ----

/** The gallery with `file` appended (a fresh id); the same file (provider + fileId) is not added twice, and a full gallery takes no more. */
export function withItemPhotoAdded(photos: readonly DraftItemPhoto[] | undefined, file: PhotoFile): DraftItemPhoto[] {
  const list = photos ?? []
  if (list.length >= MAX_DRAFT_ITEM_PHOTOS || list.some((p) => p.provider === file.provider && p.fileId === file.fileId)) return [...list]
  return [...list, { ...file, id: newId() }]
}

/** The gallery without the photo `id` (the others keep their order and ids). */
export const withItemPhotoRemoved = (photos: readonly DraftItemPhoto[] | undefined, id: Id): DraftItemPhoto[] => (photos ?? []).filter((p) => p.id !== id)
