import {
  BUILTIN_UNITS,
  formatAmount,
  draftAttribute,
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
  type Id,
  type IntakeDraftContent,
  type Intake,
  type InventorySnapshot,
  type LineResolution,
  type Quantity,
} from '@antresol/core'
import { alreadyInDraft, duplicateWarning, priceText } from '@antresol/kit'

/** Compact forms of the model for tool answers. */

/** "A/B" from the root; '' for the root and for a folder that is gone or archived. */
export function folderPath(s: InventorySnapshot, folderId: Id | null): string {
  return folderId === null ? '' : coreFolderPath(s, folderId).map((f) => f.name).join('/')
}

/** "A/B" of a folder that is in the stock or in the draft (draft folders by their chain); '' for the root or a folder that is gone. */
export function draftFolderPath(s: InventorySnapshot, draft: IntakeDraftContent, folderId: Id | null): string {
  const own = new Map((draft.newFolders ?? []).map((f) => [f.id, f] as const))
  const names: string[] = []
  const seen = new Set<Id>()
  let cur = folderId
  while (cur !== null && own.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    names.unshift(own.get(cur)!.name)
    cur = own.get(cur)!.parentId
  }
  const rest = cur === null ? '' : folderPath(s, cur)
  return [rest, ...names].filter((x) => x !== '').join('/')
}

/** Existing attributes and the draft's own, as the app sees them while the draft is open. */
export function draftAttributes(s: InventorySnapshot, draft: IntakeDraftContent): Attribute[] {
  return [...s.attributes, ...(draft.newAttributes ?? []).map((a) => draftAttribute(a, s.inventory.id))]
}

/** The unit's symbol; a unit that no longer resolves shows its key. */
export function unitSymbol(s: InventorySnapshot, unitKey: string): string {
  return resolveUnit(unitKey, s.units)?.symbol ?? unitKey
}

/** "40 pcs", "1.5 k", "2.5 m": the quantity as the app shows it. */
export function amountText(s: InventorySnapshot, q: Quantity, unitKey: string): string {
  return formatAmount(q, resolveUnit(unitKey, s.units) ?? BUILTIN_UNITS.pcs)
}

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
  photo: { url: string; replace: boolean } | null
  alreadyInDraft: boolean
}
export interface IntakeNewFolderView {
  id: Id
  /** "A/B" from the root, the draft's own parents included. */
  path: string
  problem: string | null
}
export interface IntakeNewAttributeView {
  id: Id
  name: string
  kind: 'number' | 'list' | 'text'
  unit: string | null
  siPrefixes: boolean
  options: string[]
  problem: string | null
}
export interface IntakeNewItemView {
  id: Id
  name: string
  description: string | null
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
  newAttributes: IntakeNewAttributeView[]
  newItems: IntakeNewItemView[]
  lines: IntakeLineView[]
}

export function entityProblemText(p: EntityProblem | null, what: 'folder' | 'attribute' | 'item', nameOf: (id: Id) => string): string | null {
  if (p === null) return null
  if (p.code === 'duplicate_name') return `a ${what === 'folder' ? 'folder' : 'attribute'} with this name already exists: ${nameOf(p.existingId)} (id ${p.existingId})`
  if (p.code === 'parent_gone') return 'the folder or item it belongs to is archived or gone'
  if (p.code === 'cycle') return 'the folder would be inside itself'
  return 'the name, kind, unit, tag, value or attribute does not fit'
}

/** A typed value as a number attribute shows it ("4k7" -> "4.7 kΩ"); as typed when it does not parse. */
function valueText(a: Attribute, value: string): string {
  if (a.kind !== 'number') return formatAttributeValue(a, value)
  const canonical = parseNumberValue(value, a)
  return canonical === null ? value : formatAttributeValue(a, canonical)
}

function newItemView(s: InventorySnapshot, draft: IntakeDraftContent, attrs: Attribute[], n: DraftNewItem, tagNames: ReadonlyMap<Id, string>, problem: string | null): IntakeNewItemView {
  const attributes = n.attributes.map((x) => {
    const a = attrs.find((y) => y.id === x.attributeId)
    return { name: a?.name ?? '?', value: x.value !== null && x.value.trim() !== '' ? (a ? valueText(a, x.value) : x.value) : null, axis: x.axis }
  })
  const found = duplicateWarning(s, n, n.name)
  return {
    id: n.id,
    name: n.name,
    description: n.description?.trim() ? n.description : null,
    photo: n.photo?.url ?? null,
    problem,
    folder: draftFolderPath(s, draft, n.folderId),
    unit: unitSymbol(s, n.unitKey),
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
        photo: null,
        alreadyInDraft: false,
      }),
    )
    return { ...base, ok: true, newFolders: [], newAttributes: [], newItems: [], lines }
  }
  const draft = intake.draft
  const resolved = resolveIntake(draft, s)
  const resolutions = new Map<Id, LineResolution>(resolved.lines.map((l) => [l.lineId, l.resolution]))
  const tagNames = new Map<Id, string>([...s.tags.map((t) => [t.id, t.name] as const), ...(draft.newTags ?? []).map((t) => [t.id, t.name] as const)])
  const newItems = new Map(draft.newItems.map((n) => [n.id, n]))
  const attrs = draftAttributes(s, draft)
  const problemOf = (id: Id) => resolved.entities.find((e) => e.id === id)?.problem ?? null
  const nameOf = (id: Id): string => {
    const folder = s.folders.find((f) => f.id === id)
    if (folder) return `"${folderPath(s, id)}"`
    if ((draft.newFolders ?? []).some((f) => f.id === id)) return `"${draftFolderPath(s, draft, id)}"`
    return `"${attrs.find((a) => a.id === id)?.name ?? id}"`
  }
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
      amount: amountText(s, line.quantity, unitKey),
      price: line.totalPrice === null ? null : priceText(line.totalPrice, currency),
      url: line.sourceUrl,
      photo: line.photo ? { url: line.photo.url, replace: line.photo.replace } : null,
      alreadyInDraft: alreadyInDraft(draft, line.itemId, line.axisValues, line.id),
    }
  })
  const newFolders = (draft.newFolders ?? []).map((f): IntakeNewFolderView => ({ id: f.id, path: draftFolderPath(s, draft, f.id), problem: entityProblemText(problemOf(f.id), 'folder', nameOf) }))
  const newAttributes = (draft.newAttributes ?? []).map(
    (a): IntakeNewAttributeView => ({
      id: a.id,
      name: a.name,
      kind: a.kind === 'enum' ? 'list' : a.kind,
      unit: a.kind === 'number' && a.unit.trim() !== '' ? a.unit : null,
      siPrefixes: a.kind === 'number' && a.siPrefixes,
      options: a.kind === 'enum' ? a.options : [],
      problem: entityProblemText(problemOf(a.id), 'attribute', nameOf),
    }),
  )
  return {
    ...base,
    ok: resolved.ok,
    newFolders,
    newAttributes,
    newItems: draft.newItems.map((n) => newItemView(s, draft, attrs, n, tagNames, entityProblemText(problemOf(n.id), 'item', nameOf))),
    lines,
  }
}
