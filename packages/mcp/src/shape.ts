import {
  BUILTIN_UNITS,
  formatAmount,
  formatAttributeValue,
  folderPath as coreFolderPath,
  itemAxes,
  parseNumberValue,
  resolveIntake,
  resolveUnit,
  type Attribute,
  type DraftLine,
  type DraftNewItem,
  type Id,
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
export interface IntakeNewItemView {
  id: Id
  name: string
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
  /** The draft can be committed as it is: no line has a problem. Committed: true. */
  ok: boolean
  newItems: IntakeNewItemView[]
  lines: IntakeLineView[]
}

/** A typed value as a number attribute shows it ("4k7" -> "4.7 kΩ"); as typed when it does not parse. */
function valueText(a: Attribute, value: string): string {
  if (a.kind !== 'number') return formatAttributeValue(a, value)
  const canonical = parseNumberValue(value, a)
  return canonical === null ? value : formatAttributeValue(a, canonical)
}

function newItemView(s: InventorySnapshot, n: DraftNewItem, tagNames: ReadonlyMap<Id, string>): IntakeNewItemView {
  const attributes = n.attributes.map((x) => {
    const a = s.attributes.find((y) => y.id === x.attributeId)
    return { name: a?.name ?? '?', value: x.value !== null && x.value.trim() !== '' ? (a ? valueText(a, x.value) : x.value) : null, axis: x.axis }
  })
  const found = duplicateWarning(s, n, n.name)
  return {
    id: n.id,
    name: n.name,
    folder: folderPath(s, n.folderId),
    unit: unitSymbol(s, n.unitKey),
    attributes,
    tags: (n.tagIds ?? []).map((id) => tagNames.get(id)).filter((t): t is string => t !== undefined),
    looksLike: found ? { itemId: found.itemId, name: found.name, variant: found.variantName, have: found.amount } : null,
  }
}

function lineValues(s: InventorySnapshot, line: DraftLine, newItem: DraftNewItem | undefined): string | null {
  const axes: Attribute[] = newItem
    ? newItem.attributes.filter((x) => x.axis).flatMap((x) => s.attributes.filter((a) => a.id === x.attributeId))
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
    return { ...base, ok: true, newItems: [], lines }
  }
  const draft = intake.draft
  const resolved = resolveIntake(draft, s)
  const resolutions = new Map<Id, LineResolution>(resolved.lines.map((l) => [l.lineId, l.resolution]))
  const tagNames = new Map<Id, string>([...s.tags.map((t) => [t.id, t.name] as const), ...(draft.newTags ?? []).map((t) => [t.id, t.name] as const)])
  const newItems = new Map(draft.newItems.map((n) => [n.id, n]))
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
      values: lineValues(s, line, newItem),
      amount: amountText(s, line.quantity, unitKey),
      price: line.totalPrice === null ? null : priceText(line.totalPrice, currency),
      url: line.sourceUrl,
      photo: line.photo ? { url: line.photo.url, replace: line.photo.replace } : null,
      alreadyInDraft: alreadyInDraft(draft, line.itemId, line.axisValues, line.id),
    }
  })
  return { ...base, ok: resolved.ok, newItems: draft.newItems.map((n) => newItemView(s, n, tagNames)), lines }
}
