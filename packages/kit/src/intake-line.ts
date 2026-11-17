import {
  bucketStock,
  cmpQ,
  duplicateOf,
  getCurrency,
  intakeAttributes,
  isSourceUrl,
  newId,
  MAX_NAME_LENGTH,
  intakeUnits,
  pruneDraft,
  resolveUnit,
  itemAxes,
  nearestValues,
  parseNumberValue,
  type Attribute,
  type DraftLine,
  type DraftLinePhoto,
  type DraftNewItem,
  type DraftNewTag,
  type Id,
  type IntakeDraftContent,
  type InventorySnapshot,
  type PhotoFile,
  type Quantity,
  type ResolvedIntake,
} from '@antresol/core'
import { amountExample, parseAmountText, parseMoneyText } from './amounts'
import { parseAttributeInput } from './attribute-values'
import { prunedParts, restoredParts, type RemovedNewItem } from './intake-draft'
import { existingMatches, kiloK } from './quick-add'
import { searchRows, type SearchRow } from './views'

/** What the line sheet's "what is it" field finds (spec 2026-11-13 intakes §6, state 1). */
export interface LineMatches {
  /** The thing itself: a variant whose values were typed, or an item without variants matching every word. */
  exact: SearchRow[]
  /** Items with variants matching the words that are not their values: "the same item, another value". */
  otherValue: SearchRow[]
  /** Items matching some of the words. */
  similar: SearchRow[]
  /** New items of this draft matching the name (lines can add to them: §3). */
  inDraft: { newItemId: Id; name: string }[]
}

export type ValueHint =
  | { kind: 'existing'; variantId: Id; have: Quantity }
  | { kind: 'new'; nearest: ReturnType<typeof nearestValues> }
  | { kind: 'archived'; variantId: Id }

const GROUP_LIMIT = 3
const SEARCH_LIMIT = 10

/** The words of a typed text, split on spaces. */
const wordsOf = (text: string): string[] => text.split(/\s+/).filter((w) => w !== '')

/** Typed text as the search reads values best: a decimal comma between digits is a point ("0,25" -> "0.25"; the
 *  search's own word split would cut it in two), and a unit typed in another case ("0.25w", "100nf") is spelled as the
 *  inventory's number attribute spells it ("0.25W", "100nF"): number values are read case-sensitively (m and M are
 *  different prefixes), units are not something people type carefully. Only when the result reads as a number of that
 *  attribute. */
function normalizeTyped(text: string, s: InventorySnapshot): string {
  const numbers = s.attributes.filter((a) => a.kind === 'number' && a.unit !== '')
  return wordsOf(kiloK(text).replace(/(?<=\p{N}),(?=\p{N})/gu, '.'))
    .map((word) => {
      for (const a of numbers) {
        const lower = word.toLowerCase()
        if (!lower.endsWith(a.unit.toLowerCase()) || word.endsWith(a.unit)) continue
        const fixed = word.slice(0, word.length - a.unit.length) + a.unit
        if (parseNumberValue(fixed, a) !== null) return fixed
      }
      return word
    })
    .join(' ')
}

/** The axes of an existing item or of a new item of the draft, in order. */
function axesOf(s: InventorySnapshot, draft: IntakeDraftContent | null, itemId: Id): Attribute[] {
  const n = draft?.newItems.find((x) => x.id === itemId)
  if (!n) {
    // A list attribute of the draft's added values reads them too.
    const known = draft ? intakeAttributes(draft, s) : null
    return itemAxes(s, itemId).map((a) => known?.get(a.id) ?? a)
  }
  return newItemAxes(s, draft!, n)
}

/** The axes of a new item, in order; its attributes may be the draft's own. */
function newItemAxes(s: InventorySnapshot, draft: IntakeDraftContent, n: DraftNewItem): Attribute[] {
  const known = intakeAttributes(draft, s)
  return n.attributes.flatMap((x) => {
    const a = x.axis ? known.get(x.attributeId) : undefined
    return a ? [a] : []
  })
}

/** Does a typed word read as a value of this attribute? */
function readsAs(a: Attribute, word: string): string | null {
  if (a.kind === 'number') return parseNumberValue(word, a)
  if (a.kind === 'enum') return a.options.find((o) => o.toLowerCase() === word.toLowerCase()) ?? null
  return null
}

/** The item matches every word of the query that is not one of its axis values ("resistor 0.25w 47k" for a resistor
 *  with a Resistance axis that has no 47 kΩ yet). Not when every word is a value. */
function matchesWithoutValues(s: InventorySnapshot, itemId: Id, query: string): boolean {
  const axes = itemAxes(s, itemId)
  const words = wordsOf(query)
  const rest = words.filter((w) => !axes.some((a) => readsAs(a, w) !== null))
  if (rest.length === words.length || rest.length === 0) return false
  return existingMatches(rest.join(' '), s, SEARCH_LIMIT * 5, { everyWord: true }).some((r) => r.itemId === itemId)
}

/** Lower-case letters and digits only: "Fuse holder 5x20" -> "fuseholder5x20". */
const compact = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}.]+/gu, '')

/**
 * The inventory's things and the draft's new items for what was typed in the line sheet, grouped as the sheet shows
 * them: the exact variant first, the same item for another value, similar items. Search without typo tolerance, values
 * read by the number attributes' rules ("4k7" is 4.7 kΩ). An item is in one group only, except an item whose exact
 * variant was found: it is also offered for another value.
 */
export function lineMatches(query: string, s: InventorySnapshot, draft: IntakeDraftContent): LineMatches {
  const text = normalizeTyped(query.trim(), s)
  if (text === '') return { exact: [], otherValue: [], similar: [], inDraft: [] }
  const strict = existingMatches(text, s, SEARCH_LIMIT, { everyWord: true })
  const loose = existingMatches(text, s, SEARCH_LIMIT)

  const exact = strict.filter((r) => r.variantId !== null || !r.hasVariants).slice(0, GROUP_LIMIT)
  const otherIds: Id[] = []
  for (const r of [...strict, ...loose]) {
    if (!r.hasVariants || otherIds.includes(r.itemId)) continue
    if (strict.includes(r) || matchesWithoutValues(s, r.itemId, text)) otherIds.push(r.itemId)
  }
  const otherValue = searchRows(
    s,
    otherIds.slice(0, GROUP_LIMIT).map((itemId) => ({ itemId, variantId: null })),
  )
  const taken = new Set([...exact, ...otherValue].map((r) => r.itemId))
  const similar = loose.filter((r) => !taken.has(r.itemId)).slice(0, GROUP_LIMIT)

  const words = wordsOf(text)
    .map(compact)
    .filter((w) => w.replace(/\./g, '').length >= 2)
  const inDraft = draft.newItems
    .map((n) => ({ n, hits: words.filter((w) => compact(n.name).includes(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.n.name.localeCompare(b.n.name))
    .slice(0, GROUP_LIMIT)
    .map(({ n }) => ({ newItemId: n.id, name: n.name }))

  return { exact, otherValue, similar, inDraft }
}

/** The values on the item's axes that the typed text holds ("resistor 47k" -> Resistance 47000), for a line that
 *  picks the item for another value. Each word gives one axis at most. */
export function valuesFromQuery(
  s: InventorySnapshot,
  itemId: Id,
  query: string,
  draft: IntakeDraftContent | null = null,
): { attributeId: Id; value: string }[] {
  const words = wordsOf(normalizeTyped(query, s))
  const used = new Set<number>()
  const out: { attributeId: Id; value: string }[] = []
  for (const a of axesOf(s, draft, itemId)) {
    const at = words.findIndex((w, n) => !used.has(n) && readsAs(a, w) !== null)
    if (at < 0) continue
    used.add(at)
    out.push({ attributeId: a.id, value: readsAs(a, words[at]!)! })
  }
  return out
}

/** The typed values as the axes store them; null while one is missing or does not fit. */
function canonicalValues(axes: readonly Attribute[], values: readonly { attributeId: Id; value: string }[]): Map<Id, string> | null {
  const out = new Map<Id, string>()
  for (const a of axes) {
    const typed = values.find((x) => x.attributeId === a.id)?.value
    if (typed === undefined || typed.trim() === '') return null
    const parsed = parseAttributeInput(a, typed)
    if (!('value' in parsed)) return null
    out.set(a.id, parsed.value)
  }
  return out
}

/**
 * What the values on a line's axes come to (§6, state 3): a variant the item has (the line adds to it; an archived one
 * comes back), or a new value, with the item's own nearest values of its first number axis. Every value of a new item
 * of the draft is new; there are no nearest values for it. Null while a value is missing or does not fit, and for an
 * item without axes.
 */
export function valueHint(
  s: InventorySnapshot,
  draft: IntakeDraftContent,
  itemId: Id,
  values: { attributeId: Id; value: string }[],
): ValueHint | null {
  const isNew = draft.newItems.some((n) => n.id === itemId)
  const axes = axesOf(s, draft, itemId)
  if (axes.length === 0) return null
  const canonical = canonicalValues(axes, values)
  if (!canonical) return null
  const none = { below: null, above: null }
  if (isNew) return { kind: 'new', nearest: none }
  const same = duplicateOf(s, itemId, canonical)
  if (same) {
    return same.archivedAt !== null
      ? { kind: 'archived', variantId: same.id }
      : { kind: 'existing', variantId: same.id, have: bucketStock(s, itemId, same.id).quantity }
  }
  const numberAxis = axes.find((a) => a.kind === 'number')
  if (!numberAxis) return { kind: 'new', nearest: none }
  const ownItem: InventorySnapshot = { ...s, items: s.items.filter((i) => i.id === itemId) }
  return { kind: 'new', nearest: nearestValues(ownItem, numberAxis, canonical.get(numberAxis.id)!) }
}

/**
 * "Looks like you already have this" for a new item (§6, state 4): the thing the inventory has under this name, or
 * with the same values, found without typo tolerance; values written differently count as the same ("4k7" = 4.7k).
 * `query`: what the line was typed as, the name and its values. A variant found is preferred to its item. Does not
 * block anything: it is a warning.
 */
export function duplicateWarning(s: InventorySnapshot, newItem: DraftNewItem, query: string): SearchRow | null {
  const shared = newItem.attributes.flatMap((x) => (!x.axis && x.value?.trim() ? [x.value.trim()] : []))
  const texts = [
    [query, ...shared].join(' '),
    query,
    [newItem.name, ...shared].join(' '),
    newItem.name,
  ].map((t) => normalizeTyped(t.trim(), s))
  for (const text of new Set(texts)) {
    if (text === '') continue
    const rows = existingMatches(text, s, GROUP_LIMIT, { everyWord: true })
    if (rows.length > 0) return rows.find((r) => r.variantId !== null) ?? rows[0]!
  }
  return null
}

const valueKey = (values: readonly { attributeId: Id; value: string }[]): string =>
  JSON.stringify([...values].map((x) => [x.attributeId, x.value.trim().toLowerCase()]).sort())

/** Another line of the draft already brings this item with these values ("already in this intake", §5). */
export function alreadyInDraft(
  draft: IntakeDraftContent,
  itemId: Id,
  values: { attributeId: Id; value: string }[],
  exceptLineId?: Id,
): boolean {
  const key = valueKey(values)
  return draft.lines.some((l) => l.id !== exceptLineId && l.itemId === itemId && valueKey(l.axisValues) === key)
}

/** The folder a new item would go next to (§6, state 4): the folder of the first thing found, and its name. */
export function suggestedFolder(s: InventorySnapshot, matches: LineMatches): { folderId: Id | null; nextTo: string } | null {
  for (const r of [...matches.exact, ...matches.otherValue, ...matches.similar]) {
    const item = s.items.find((i) => i.id === r.itemId)
    if (item) return { folderId: item.folderId, nextTo: item.name }
  }
  return null
}

/** The scheme and host of a web link: "https://lcsc.com/product-detail/C25819.html" -> "https://lcsc.com". */
function originOf(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
  } catch {
    return null
  }
}

/** What "Add & next" keeps for the next line (§6): the folder and the unit of the line's item, the shop of its link.
 *  An existing item's folder and unit come from the copy `s`. */
export function nextLineDefaults(
  prev: DraftLine,
  draft: IntakeDraftContent,
  s?: InventorySnapshot,
): { folderId: Id | null; unitKey: string; urlPrefix: string | null } {
  const n = draft.newItems.find((x) => x.id === prev.itemId)
  const item = n ? undefined : s?.items.find((i) => i.id === prev.itemId)
  return {
    folderId: n?.folderId ?? item?.folderId ?? null,
    unitKey: n?.unitKey ?? item?.unitKey ?? 'pcs',
    urlPrefix: originOf(prev.sourceUrl),
  }
}

/** A similar item's attributes for a new one, values empty (§6, state 4): shared ones first, then the axes in order. */
export function attributesFrom(s: InventorySnapshot, itemId: Id): DraftNewItem['attributes'] {
  const own = s.itemAttributes.filter((a) => a.itemId === itemId)
  const shared = own.filter((a) => a.axisPosition === null)
  const axes = own.filter((a) => a.axisPosition !== null).sort((a, b) => a.axisPosition! - b.axisPosition!)
  return [
    ...shared.map((a) => ({ attributeId: a.attributeId, value: null, axis: false })),
    ...axes.map((a) => ({ attributeId: a.attributeId, value: null, axis: true })),
  ]
}

/** The line sheet's fields as typed. `newItem`: the item is a new one (of the draft, or made by this line). */
export interface LineForm {
  lineId: Id
  ids: DraftLine['ids']
  /** An existing item, or newItem.id. */
  itemId: Id
  newItem: DraftNewItem | null
  /** Typed values on the item's axes. */
  axisValues: { attributeId: Id; value: string }[]
  amount: string
  price: string
  url: string
  /** The shop's address the link field was started with ("Add & next"): left as it is, it is no link. */
  urlPrefix: string | null
  /** `replace`: the person chose "Replace photo"; kept only while the variant the line goes to has a photo. */
  photo: DraftLinePhoto | null
  /** The new tags the form added or shows (of the draft); only those the new item uses are kept. */
  newTags: DraftNewTag[]
  /** The description of the variant this line creates; trimmed, empty is none. Kept on the line; core uses it only
   *  when this line is the one creating the variant. */
  variantDescription?: string | null
}
export type BuiltLine = { line: DraftLine; newItem: DraftNewItem | null; newTags: DraftNewTag[] } | { errorKey: string; params?: Record<string, string> }

/** A photo without the line's "replace" flag: the item's own photo. */
export function fileOnly(p: DraftLinePhoto): PhotoFile {
  const file: Partial<DraftLinePhoto> = { ...p }
  delete file.replace
  return file as PhotoFile
}

/** The other line that creates the same new variant as a line for `itemId` with these typed values would: for a new
 *  item without axes any other line of it, otherwise a line of the same item with the same values; for an existing
 *  item only a value it does not have yet creates a variant. Null for a line that tops up what exists, and while a value
 *  is missing or does not fit. `exceptLineId`: the line being edited. */
export function creatingLineOf(
  s: InventorySnapshot,
  draft: IntakeDraftContent,
  itemId: Id,
  values: { attributeId: Id; value: string }[],
  exceptLineId?: Id,
): Id | null {
  const isNew = draft.newItems.some((n) => n.id === itemId)
  if (!isNew && !s.items.some((i) => i.id === itemId)) return null
  const axes = axesOf(s, draft, itemId)
  const others = draft.lines.filter((l) => l.id !== exceptLineId && l.itemId === itemId)
  if (axes.length === 0) return isNew ? (others[0]?.id ?? null) : null
  const canonical = canonicalValues(axes, values)
  if (!canonical) return null
  if (!isNew && duplicateOf(s, itemId, canonical)) return null
  const key = valueKey([...canonical].map(([attributeId, value]) => ({ attributeId, value })))
  return others.find((l) => valueKey(l.axisValues) === key)?.id ?? null
}

/** The sheet's fields as a draft line (and its new item), values as the axes store them; or what to fix. A line needs an
 *  amount and a value on every axis, and its link must be an http(s) address; a new item needs a name that is not too
 *  long. What the commit would refuse is refused here, so no line fails the whole commit (spec §7). */
export function buildDraftLine(form: LineForm, s: InventorySnapshot, draft: IntakeDraftContent): BuiltLine {
  const n = form.newItem
  const item = n ? null : s.items.find((i) => i.id === form.itemId)
  if (!n && !item) return { errorKey: 'intakes.problem.unknown_item' }
  const name = n ? n.name.trim() : item!.name
  if (name === '') return { errorKey: 'errors.domain.name_required' }
  if (n && name.length > MAX_NAME_LENGTH) return { errorKey: 'errors.domain.name_too_long' }

  const known = intakeAttributes(draft, s)
  const axes = n ? newItemAxes(s, draft, n) : axesOf(s, draft, form.itemId)
  const axisValues: DraftLine['axisValues'] = []
  for (const a of axes) {
    const typed = form.axisValues.find((x) => x.attributeId === a.id)?.value ?? ''
    if (typed.trim() === '') return { errorKey: 'intakes.line.needsValue', params: { name: a.name } }
    const parsed = parseAttributeInput(a, typed)
    if (!('value' in parsed)) return { errorKey: 'intakes.line.invalidValue', params: { name: a.name } }
    axisValues.push({ attributeId: a.id, value: parsed.value })
  }
  for (const x of n?.attributes ?? []) {
    const a = !x.axis && x.value?.trim() ? known.get(x.attributeId) : undefined
    if (a && !('value' in parseAttributeInput(a, x.value!))) return { errorKey: 'intakes.line.invalidValue', params: { name: a.name } }
  }

  const unit = resolveUnit(n ? n.unitKey : item!.unitKey, intakeUnits(draft, s))
  if (!unit) return { errorKey: 'intakes.problem.invalid_value' }
  if (form.amount.trim() === '') return { errorKey: 'intakes.line.needsAmount' }
  const quantity = parseAmountText(form.amount, unit)
  if (quantity === null) return { errorKey: 'quickAdd.invalidAmount', params: { example: amountExample(unit) } }
  if (cmpQ(quantity, '0') <= 0) return { errorKey: 'intakes.line.needsAmount' }

  let totalPrice: number | null = null
  if (form.price.trim() !== '') {
    totalPrice = parseMoneyText(form.price, s.inventory.currency)
    if (totalPrice === null) return { errorKey: 'quickAdd.invalidPrice' }
  }
  const typedUrl = form.url.trim()
  const prefix = form.urlPrefix
  const sourceUrl = typedUrl === '' || (prefix !== null && (typedUrl === prefix || typedUrl === `${prefix}/`)) ? null : typedUrl
  if (sourceUrl !== null && !isSourceUrl(sourceUrl)) return { errorKey: 'errors.domain.invalid_url' }

  const newItem: DraftNewItem | null = n
    ? {
        ...n,
        name,
        attributes: n.attributes.map((x) => (x.axis ? { ...x, value: null } : { ...x, value: x.value?.trim() ? x.value.trim() : null })),
      }
    : null
  // Photo rules (spec 2026-11-16 intake entities §5). A line that tops up what exists carries no photo (one an older
  // draft already has on this very line is kept). A new item without axes has one field for the line's photo and the
  // item's: it is the item's. A new variant keeps the photo on its line; the variant has none yet, so it replaces nothing.
  const values = new Map(axisValues.map((x) => [x.attributeId, x.value] as const))
  const topsUp = !n && (axes.length === 0 || duplicateOf(s, form.itemId, values) !== null)
  if (!topsUp) {
    // The item as the form has it (its axes may have changed), not as the draft stores it.
    const seen = n ? { ...draft, newItems: draft.newItems.some((x) => x.id === n.id) ? draft.newItems.map((x) => (x.id === n.id ? n : x)) : [...draft.newItems, n] } : draft
    const other = creatingLineOf(s, seen, form.itemId, axisValues, form.lineId)
    if (other) return { errorKey: 'intakes.line.alreadyCreated', params: { line: other } }
  }
  const kept = draft.lines.find((l) => l.id === form.lineId)?.photo
  if (topsUp && form.photo && !(kept && kept.fileId === form.photo.fileId && kept.provider === form.photo.provider)) {
    return { errorKey: 'intakes.line.noPhotoOnTopUp' }
  }
  let linePhoto: DraftLinePhoto | null = topsUp ? form.photo : form.photo ? { ...form.photo, replace: false } : null
  if (newItem && axes.length === 0) {
    const file = form.photo ? fileOnly(form.photo) : newItem.photo
    if (file) {
      newItem.photo = file
      newItem.photoId ??= newId()
    }
    linePhoto = null
  }
  const variantDescription = form.variantDescription === undefined ? undefined : form.variantDescription?.trim() || null
  return {
    line: { id: form.lineId, itemId: form.itemId, axisValues, quantity, totalPrice, sourceUrl, photo: linePhoto, ids: form.ids, ...(variantDescription !== undefined ? { variantDescription } : {}) },
    newItem,
    newTags: newItem ? form.newTags.filter((t) => newItem.tagIds?.includes(t.id)) : [],
  }
}

/** The draft with the line put in (in its place when it is there already) and its new item put in or updated. New items
 *  live on their own: one left without lines stays (withoutNewItem removes it). */
export function withLine(draft: IntakeDraftContent, line: DraftLine, newItem: DraftNewItem | null, newTags: DraftNewTag[] = []): IntakeDraftContent {
  const replace = <T extends { id: Id }>(list: T[], x: T): T[] =>
    list.some((y) => y.id === x.id) ? list.map((y) => (y.id === x.id ? x : y)) : [...list, x]
  const tags = newTags.reduce((list, t) => replace(list, t), draft.newTags ?? [])
  return pruneDraft({
    ...draft,
    newItems: newItem ? replace(draft.newItems, newItem) : draft.newItems,
    lines: replace(draft.lines, line),
    ...(tags.length > 0 || draft.newTags ? { newTags: tags } : {}),
  })
}

/** What Undo of withoutLine puts back: the line, its place, and the parts pruned with it. */
export type RemovedLine = Pick<RemovedNewItem, 'newTags' | 'newAttributes' | 'newUnits' | 'addedOptions'> & {
  line: DraftLine
  index: number
  newItem: DraftNewItem | null
}

/** The draft without the line, and what Undo puts back: the line and its place (`newItem` and `newTags` stay for
 *  callers; a new item no longer goes with its last line, so they are null and empty). */
export function withoutLine(
  draft: IntakeDraftContent,
  lineId: Id,
): { content: IntakeDraftContent; removed: RemovedLine | null } {
  const index = draft.lines.findIndex((l) => l.id === lineId)
  if (index < 0) return { content: draft, removed: null }
  const line = draft.lines[index]!
  const content = pruneDraft({ ...draft, lines: draft.lines.filter((l) => l.id !== lineId) })
  const newItem = draft.newItems.find((n) => n.id === line.itemId && !content.newItems.some((m) => m.id === n.id)) ?? null
  return { content, removed: { line, index, newItem, ...prunedParts(draft, content) } }
}

/** Undo of withoutLine: the line back in its place, with its new item. */
export function restoreLine(
  draft: IntakeDraftContent,
  removed: RemovedLine,
): IntakeDraftContent {
  if (draft.lines.some((l) => l.id === removed.line.id)) return draft
  const lines = [...draft.lines]
  lines.splice(Math.min(removed.index, lines.length), 0, removed.line)
  const newItems =
    removed.newItem && !draft.newItems.some((n) => n.id === removed.newItem!.id) ? [...draft.newItems, removed.newItem] : draft.newItems
  return restoredParts({ ...draft, newItems, lines }, removed)
}

/** Minor units as the price field shows them, in integers only: 1234 USD -> "12.34", 50 JPY -> "50". */
export function priceText(minor: number, currency: string): string {
  const decimals = getCurrency(currency)?.decimals ?? 2
  if (decimals === 0) return String(minor)
  const digits = String(minor).padStart(decimals + 1, '0')
  return `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`
}

/** The commit button's text key and count: "Commit · 3 lines"; with no lines, the new items ("Commit · 2 items"), then the
 *  folders and attributes alone ("Commit · 2 new parts"). Null when there is nothing to commit (the button is off). */
export function commitLabel(draft: IntakeDraftContent, resolved: ResolvedIntake): { key: string; count: number } | null {
  if (draft.lines.length > 0) return { key: 'intakes.screen.commitLines', count: draft.lines.length }
  const items = resolved.entities.filter((e) => e.kind === 'item').length
  if (items > 0) return { key: 'intakes.screen.commitItems', count: items }
  const parts = resolved.entities.length
  if (parts > 0) return { key: 'intakes.screen.commitParts', count: parts }
  return null
}
