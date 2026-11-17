import {
  BUILTIN_UNITS,
  customUnitKey,
  formatAmount,
  draftAttribute,
  intakeUnits,
  SI_PREFIXES,
  MAX_PINNED_ATTRIBUTES,
  type CustomUnit,
  formatAttributeValue,
  folderPath as coreFolderPath,
  itemAxes,
  parseNumberValue,
  resolveIntake,
  resolveUnit,
  type Attribute,
  type DraftLine,
  type DraftNewItem,
  type EntityProblem,
  type ResolvedEntity,
  type Id,
  type IntakeCreated,
  type IntakeDraftContent,
  type Intake,
  type InventorySnapshot,
  type LineResolution,
  type Quantity,
} from '@antresol/core'
import { alreadyInDraft, duplicateWarning, folderPathWithDraft, priceText } from '@antresol/kit'

/** Compact forms of the model for tool answers. */

/** "A/B" from the root; '' for the root and for a folder that is gone or archived. */
export function folderPath(s: InventorySnapshot, folderId: Id | null): string {
  return folderId === null ? '' : coreFolderPath(s, folderId).map((f) => f.name).join('/')
}

/** "A/B" of a folder that is in the stock or in the draft (draft folders by their chain, archived ones shown); '' for the root or a folder that is gone. */
export const draftFolderPath = (s: InventorySnapshot, draft: IntakeDraftContent, folderId: Id | null): string => folderPathWithDraft(s, draft, folderId).join('/')

/** Existing attributes and the draft's own, as the app sees them while the draft is open. */
export function draftAttributes(s: InventorySnapshot, draft: IntakeDraftContent): Attribute[] {
  return [...s.attributes, ...(draft.newAttributes ?? []).map((a) => draftAttribute(a, s.inventory.id))]
}

/** The unit's symbol; a unit that no longer resolves shows its key. `units`: the stock's custom units, or with the draft's own. */
export function unitSymbol(s: InventorySnapshot, unitKey: string, units: CustomUnit[] = s.units): string {
  return resolveUnit(unitKey, units)?.symbol ?? unitKey
}

/** "40 pcs", "1.5 k", "2.5 m": the quantity as the app shows it. */
export function amountText(s: InventorySnapshot, q: Quantity, unitKey: string, units: CustomUnit[] = s.units): string {
  return formatAmount(q, resolveUnit(unitKey, units) ?? BUILTIN_UNITS.pcs)
}

/** The prefixes a unit takes, as symbols ("k", "m", "µ"), largest first. */
export const prefixSymbols = (powers: readonly number[]): string[] =>
  [...powers].sort((a, b) => b - a).map((p) => SI_PREFIXES[p]?.symbol ?? `10^${p}`)

export type IntakeProblem = 'item_archived' | 'missing_axis_value' | 'invalid_value' | 'unknown_item' | 'invalid_link' | 'duplicate_line'
const PROBLEM_TEXT: Record<IntakeProblem, string> = {
  item_archived: 'the item or its folder is archived',
  missing_axis_value: 'a value is missing for a variant attribute of the item',
  invalid_value: 'a value, the unit, a tag or the name does not fit',
  unknown_item: 'the item does not exist',
  invalid_link: 'the link is not a valid web address',
  duplicate_line: 'another line of this intake already creates this variant or item',
}
export const problemText = (code: IntakeProblem): string => PROBLEM_TEXT[code]

export interface IntakeLineView {
  id: Id
  kind: 'add' | 'newValue' | 'newItem' | 'problem'
  problem: string | null
  itemId: Id
  item: string | null
  /** The variant's values, "4.7 kΩ / 50 V"; null for an item without variant attributes. */
  values: string | null
  amount: string
  price: string | null
  url: string | null
  /** The description of the variant this line creates; null when it has none. */
  variantDescription: string | null
  photo: { url: string; replace: boolean } | null
  alreadyInDraft: boolean
}
export interface IntakeNewFolderView {
  id: Id
  /** "A/B" from the root, the draft's own parents included. */
  path: string
  icon: string | null
  problem: string | null
}
export interface IntakeNewUnitView {
  id: Id
  name: string
  symbol: string
  /** The prefixes it takes, "k", "m", ... */
  prefixes: string[]
  problem: string | null
}
export interface IntakeNewTagView {
  id: Id
  name: string
  color: string | null
  problem: string | null
}
export interface IntakeAddedValuesView {
  /** The existing list attribute that gets the values. */
  attribute: string
  values: string[]
  problem: string | null
}
export interface IntakeNewAttributeView {
  id: Id
  name: string
  kind: 'number' | 'list' | 'text'
  unit: string | null
  siPrefixes: boolean
  options: string[]
  /** Shown in lists ("Show in lists"). */
  pinned: boolean
  problem: string | null
}
export interface IntakeNewItemView {
  id: Id
  name: string
  description: string | null
  icon: string | null
  color: string | null
  photo: string | null
  /** What keeps the item from being created; null when nothing does. */
  problem: string | null
  folder: string
  unit: string
  attributes: { name: string; value: string | null; axis: boolean }[]
  tags: string[]
  looksLike: { itemId: Id; name: string; variant: string | null; have: string } | null
}
export interface IntakeView {
  id: Id
  inventory: string
  status: 'draft' | 'committed'
  header: Intake['header']
  createdBy: string
  updatedBy: string
  updatedAt: string
  /** The draft can be committed as it is: no line, folder, attribute or new item has a problem, and it does something (a line or something to create). Committed: true. */
  ok: boolean
  newFolders: IntakeNewFolderView[]
  newUnits: IntakeNewUnitView[]
  newAttributes: IntakeNewAttributeView[]
  newTags: IntakeNewTagView[]
  /** Values the commit appends to existing list attributes. */
  addedValues: IntakeAddedValuesView[]
  newItems: IntakeNewItemView[]
  lines: IntakeLineView[]
  /** Committed only, when the commit recorded it: what it made, so the assistant sees what exists now. */
  created?: IntakeCreatedView
}
export interface IntakeCreatedView {
  folders: { id: Id; path: string }[]
  units: { id: Id; name: string; symbol: string }[]
  attributes: { id: Id; name: string }[]
  tags: { id: Id; name: string }[]
  appendedValues: { attribute: string; values: string[] }[]
  items: { id: Id; name: string; folder: string }[]
}

const NOUN: Record<ResolvedEntity['kind'], string> = { folder: 'folder', unit: 'unit', attribute: 'attribute', tag: 'tag', option: 'list value', item: 'item' }
const withArticle = (noun: string): string => (noun === 'item' || noun === 'attribute' ? `an ${noun}` : `a ${noun}`)

/** What an entity problem of the draft says, in the app's words; `nameOf` names the entity it clashes with (a unit by its key). */
export function entityProblemText(p: EntityProblem | null, what: ResolvedEntity['kind'], nameOf: (id: Id) => string): string | null {
  if (p === null) return null
  const noun = NOUN[what]
  const ref = (id: Id) => `${nameOf(id)} (${what === 'unit' ? 'key' : 'id'} ${id})`
  if (p.code === 'duplicate_name') return `${withArticle(noun)} with this name already exists: ${ref(p.existingId)}; use it, or choose another name`
  if (p.code === 'duplicate_archived') return `an archived ${noun} with this name is here: ${ref(p.existingId)}; restore it in the app or choose another name`
  if (p.code === 'parent_gone') return 'the folder or item it belongs to is archived or gone'
  if (p.code === 'cycle') return 'the folder would be inside itself'
  if (p.code === 'pinned_limit') return `too many attributes are shown in lists (at most ${MAX_PINNED_ATTRIBUTES}); turn "pinned" off on this one or on another`
  return 'the name, kind, unit, tag, colour, icon, value or attribute does not fit'
}

/** Names for the ids an entity problem points at: folders (paths), attributes, items ("Name" in "path"), units (by key). */
export function entityNamer(s: InventorySnapshot, draft: IntakeDraftContent): (id: Id) => string {
  const attrs = draftAttributes(s, draft)
  const units = intakeUnits(draft, s)
  return (id) => {
    if (s.folders.some((f) => f.id === id) || (draft.newFolders ?? []).some((f) => f.id === id)) return `"${draftFolderPath(s, draft, id)}"`
    const item = s.items.find((i) => i.id === id) ?? draft.newItems.find((i) => i.id === id)
    if (item) return `"${item.name}" in "${draftFolderPath(s, draft, item.folderId) || 'the root'}"`
    const unit = resolveUnit(id, units)
    if (unit) return `"${unit.name}"`
    const draftUnit = (draft.newUnits ?? []).find((u) => u.id === id)
    if (draftUnit) return `"${draftUnit.name}"`
    const tag = s.tags.find((t) => t.id === id) ?? (draft.newTags ?? []).find((t) => t.id === id)
    if (tag) return `"${tag.name}"`
    return `"${attrs.find((a) => a.id === id)?.name ?? id}"`
  }
}

/** A typed value as a number attribute shows it ("4k7" -> "4.7 kΩ"); as typed when it does not parse. */
function valueText(a: Attribute, value: string): string {
  if (a.kind !== 'number') return formatAttributeValue(a, value)
  const canonical = parseNumberValue(value, a)
  return canonical === null ? value : formatAttributeValue(a, canonical)
}

function newItemView(s: InventorySnapshot, draft: IntakeDraftContent, attrs: Attribute[], n: DraftNewItem, tagNames: ReadonlyMap<Id, string>, problem: string | null): IntakeNewItemView {
  const units = intakeUnits(draft, s)
  const attributes = n.attributes.map((x) => {
    const a = attrs.find((y) => y.id === x.attributeId)
    return { name: a?.name ?? '?', value: x.value !== null && x.value.trim() !== '' ? (a ? valueText(a, x.value) : x.value) : null, axis: x.axis }
  })
  const found = duplicateWarning(s, n, n.name)
  return {
    id: n.id,
    name: n.name,
    description: n.description?.trim() ? n.description : null,
    icon: n.icon ?? null,
    color: n.color ?? null,
    photo: n.photo?.url ?? null,
    problem,
    folder: draftFolderPath(s, draft, n.folderId),
    unit: unitSymbol(s, n.unitKey, units),
    attributes,
    tags: (n.tagIds ?? []).map((id) => tagNames.get(id)).filter((t): t is string => t !== undefined),
    looksLike: found ? { itemId: found.itemId, name: found.name, variant: found.variantName, have: found.amount } : null,
  }
}

function lineValues(s: InventorySnapshot, attrs: Attribute[], line: DraftLine, newItem: DraftNewItem | undefined): string | null {
  const axes: Attribute[] = newItem
    ? newItem.attributes.filter((x) => x.axis).flatMap((x) => attrs.filter((a) => a.id === x.attributeId))
    : itemAxes(s, line.itemId)
  const parts = axes.flatMap((a) => {
    const typed = line.axisValues.find((x) => x.attributeId === a.id)?.value
    return typed === undefined || typed.trim() === '' ? [] : [valueText(a, typed.trim())]
  })
  return parts.length > 0 ? parts.join(' / ') : null
}

/** What a commit made, with the names it had then; folder paths run through the created folders and the stock's. */
function createdView(s: InventorySnapshot, c: IntakeCreated): IntakeCreatedView {
  const made: IntakeDraftContent = { newItems: [], lines: [], newFolders: c.folders }
  const path = (id: Id | null) => draftFolderPath(s, made, id)
  return {
    folders: c.folders.map((f) => ({ id: f.id, path: path(f.id) })),
    units: (c.units ?? []).map((u) => ({ id: u.id, name: u.name, symbol: u.symbol })),
    attributes: c.attributes.map((a) => ({ id: a.id, name: a.name })),
    tags: c.tags.map((t) => ({ id: t.id, name: t.name })),
    appendedValues: (c.appendedOptions ?? []).map((o) => ({ attribute: o.name, values: o.values })),
    items: c.items.map((i) => ({ id: i.id, name: i.name, folder: path(i.folderId) })),
  }
}

/** A draft or a committed intake as the tools tell it (a draft with the problems the app would show). */
export function intakeView(s: InventorySnapshot, intake: Intake): IntakeView {
  const base = {
    id: intake.id,
    inventory: s.inventory.name,
    status: intake.status,
    header: intake.header,
    createdBy: intake.createdBy,
    updatedBy: intake.updatedBy,
    updatedAt: intake.updatedAt,
  }
  const currency = s.inventory.currency
  if (intake.draft === null) {
    const lines = (intake.lines ?? []).map(
      (l): IntakeLineView => ({
        id: l.lineId,
        kind: l.kind,
        problem: null,
        itemId: l.itemId,
        item: l.itemName,
        values: l.variantLabel,
        amount: amountText(s, l.quantity, l.unitKey),
        price: l.totalPrice === null ? null : priceText(l.totalPrice, currency),
        url: l.sourceUrl,
        variantDescription: null,
        photo: null,
        alreadyInDraft: false,
      }),
    )
    return { ...base, ok: true, newFolders: [], newUnits: [], newAttributes: [], newTags: [], addedValues: [], newItems: [], lines, ...(intake.created ? { created: createdView(s, intake.created) } : {}) }
  }
  const draft = intake.draft
  const resolved = resolveIntake(draft, s)
  const resolutions = new Map<Id, LineResolution>(resolved.lines.map((l) => [l.lineId, l.resolution]))
  const tagNames = new Map<Id, string>([...s.tags.map((t) => [t.id, t.name] as const), ...(draft.newTags ?? []).map((t) => [t.id, t.name] as const)])
  const newItems = new Map(draft.newItems.map((n) => [n.id, n]))
  const attrs = draftAttributes(s, draft)
  const problemOf = (id: Id) => resolved.entities.find((e) => e.id === id)?.problem ?? null
  const nameOf = entityNamer(s, draft)
  const units = intakeUnits(draft, s)
  const lines = draft.lines.map((line): IntakeLineView => {
    const resolution = resolutions.get(line.id)
    const newItem = newItems.get(line.itemId)
    const existing = s.items.find((i) => i.id === line.itemId)
    const unitKey = newItem?.unitKey ?? existing?.unitKey ?? 'pcs'
    return {
      id: line.id,
      kind: resolution?.kind ?? 'problem',
      problem: resolution?.kind === 'problem' ? problemText(resolution.code) : null,
      itemId: line.itemId,
      item: newItem?.name ?? existing?.name ?? null,
      values: lineValues(s, attrs, line, newItem),
      amount: amountText(s, line.quantity, unitKey, units),
      price: line.totalPrice === null ? null : priceText(line.totalPrice, currency),
      url: line.sourceUrl,
      variantDescription: line.variantDescription?.trim() ? line.variantDescription.trim() : null,
      photo: line.photo ? { url: line.photo.url, replace: line.photo.replace } : null,
      alreadyInDraft: alreadyInDraft(draft, line.itemId, line.axisValues, line.id),
    }
  })
  const newFolders = (draft.newFolders ?? []).map((f): IntakeNewFolderView => ({ id: f.id, path: draftFolderPath(s, draft, f.id), icon: f.icon ?? null, problem: entityProblemText(problemOf(f.id), 'folder', nameOf) }))
  const newAttributes = (draft.newAttributes ?? []).map(
    (a): IntakeNewAttributeView => ({
      id: a.id,
      name: a.name,
      kind: a.kind === 'enum' ? 'list' : a.kind,
      unit: a.kind === 'number' && a.unit.trim() !== '' ? a.unit : null,
      siPrefixes: a.kind === 'number' && a.siPrefixes,
      options: a.kind === 'enum' ? a.options : [],
      pinned: a.pinned === true,
      problem: entityProblemText(problemOf(a.id), 'attribute', nameOf),
    }),
  )
  const newUnits = (draft.newUnits ?? []).map(
    (u): IntakeNewUnitView => ({ id: u.id, name: u.name, symbol: u.symbol, prefixes: prefixSymbols(u.prefixPowers), problem: entityProblemText(problemOf(u.id), 'unit', nameOf) }),
  )
  const newTags = (draft.newTags ?? []).map((t): IntakeNewTagView => ({ id: t.id, name: t.name, color: t.color ?? null, problem: entityProblemText(problemOf(t.id), 'tag', nameOf) }))
  const addedValues = (draft.addedOptions ?? []).map(
    (o): IntakeAddedValuesView => ({ attribute: s.attributes.find((a) => a.id === o.attributeId)?.name ?? o.attributeId, values: o.values, problem: entityProblemText(problemOf(o.attributeId), 'option', nameOf) }),
  )
  return {
    ...base,
    ok: resolved.ok,
    newFolders,
    newUnits,
    newAttributes,
    newTags,
    addedValues,
    newItems: draft.newItems.map((n) => newItemView(s, draft, attrs, n, tagNames, entityProblemText(problemOf(n.id), 'item', nameOf))),
    lines,
  }
}
