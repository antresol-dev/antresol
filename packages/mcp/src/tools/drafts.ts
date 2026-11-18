import {
  customUnitKey,
  emptyIntakeDraft,
  folderArchived,
  intakeUnits,
  isColorHex,
  isIconName,
  itemArchived,
  itemAxes,
  MAX_NAME_LENGTH,
  newId,
  pruneDraft,
  resolveIntake,
  sameName as same,
  MAX_DRAFT_ITEM_PHOTOS,
  SI_PREFIXES,
  type Attribute,
  type AttributeKind,
  type DraftLine,
  type DraftItemPhoto,
  type DraftLinePhoto,
  type DraftNewAttribute,
  type DraftNewFolder,
  type DraftNewItem,
  type Id,
  type IntakeDraftContent,
  type IntakeHeader,
  type PhotoFile,
  type Intake,
  type InventorySnapshot,
} from '@antresol/core'
import {
  buildDraftLine,
  fileOnly,
  nameClash,
  unitChoices,
  withAddedOption,
  withItemAttribute,
  withItemTag,
  withItemUnit,
  withLine,
  withNewAttribute,
  withNewFolder,
  withNewItem,
  withoutNewFolder,
  withoutNewItem,
  type DraftError,
} from '@antresol/kit'
import { requireStorage, requireSource, resolveInventory, type ToolContext } from '../context'
import { assertDraft, editDraft, locateIntake, viewAfterSave } from '../draft-edit'
import { ToolError } from '../errors'
import { messageFor } from '../messages'
import { similarOf, type SimilarEntry } from '../similar'
import { draftAttributes, draftFolderPath, entityNamer, entityProblemText, problemText, unitSymbol } from '../shape'
import { attachPhoto, checkPhoto, markPhotosUsed } from './photos'

/** An attribute under a new item: an existing one (id or name; `value` shared, `axis` per line), or a new one when `kind` is given. */
export interface AttributeArg {
  attribute: string
  value?: string
  axis?: boolean
  kind?: 'number' | 'list' | 'text'
  /** number: the unit symbol, like "Ω". */
  unit?: string
  siPrefixes?: boolean
  /** list: the choices, in order. */
  options?: string[]
  /** Shown in lists (at most two attributes of an inventory). */
  pinned?: boolean
}
/** A tag by id or name; an unknown name is a new tag, with the colour when given (#RRGGBB). */
export type TagArg = string | { name: string; color?: string }
/** A new unit: its prefixes as symbols ("k", "M", "m", "µ") or powers of ten (3, -3). */
export interface UnitArg {
  name: string
  symbol: string
  prefixes?: (string | number)[]
}
/** A value added to an existing list attribute. */
export interface ValueArg {
  attribute: string
  value: string
}
/** What a new item declares about itself. */
export interface ItemDeclarations {
  /** An existing unit by key, symbol or name (or a unit of this draft), or a new unit. 'pcs' by default. */
  unit?: string | UnitArg
  attributes?: AttributeArg[]
  tags?: TagArg[]
  /** A Lucide icon name in kebab-case, like "package". An empty text clears it. */
  icon?: string
  /** #RRGGBB. An empty text clears it. */
  color?: string
  /** Values to add to existing list attributes; the item or a line must use them. */
  addValues?: ValueArg[]
}
export interface NewItemArgs extends ItemDeclarations {
  ref: string
  name: string
  /** Folder id or path. */
  folder?: string
  description?: string
  /** Picture paths from list_photos: the item's own photos, in order; the first is the cover. */
  photos?: string[]
  /** The item is made with no line (and no stock). */
  withoutLines?: boolean
}
export interface LineArgs {
  /** An item id, the id of a new item of the draft, or the `ref` of a new item of this call. */
  item: string
  values?: Record<string, string>
  amount: string
  price?: string
  url?: string
  photo?: string
  /** Values to add to existing list attributes (also for an existing item); this line or another must use them. */
  addValues?: ValueArg[]
  /** The description of the variant this line creates. */
  description?: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function today(ctx: ToolContext): string {
  const d = ctx.now()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A typed header field: trimmed, empty is none. */
const field = (text: string | undefined): string | null => (text?.trim() ? text.trim() : null)

function checkDate(text: string): string {
  const t = text.trim()
  const ok = DATE.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) && new Date(`${t}T00:00:00Z`).toISOString().startsWith(t)
  if (!ok) throw new ToolError(`purchasedOn "${text}" is not a date: use YYYY-MM-DD.`)
  return t
}

export async function createIntake(
  ctx: ToolContext,
  args: { inventory?: string; shop?: string; orderNumber?: string; purchasedOn?: string; note?: string },
) {
  const storage = requireStorage(ctx)
  if (requireSource(ctx).readOnly) throw new ToolError('The database was made by a newer version of Antresol and is read-only for this MCP server. Update Antresol MCP.')
  const { inventory, snapshot } = await resolveInventory(ctx, args.inventory)
  const header: IntakeHeader = {
    shop: field(args.shop),
    orderNumber: field(args.orderNumber),
    purchasedOn: args.purchasedOn?.trim() ? checkDate(args.purchasedOn) : today(ctx),
    note: field(args.note),
  }
  const id = newId()
  const content = emptyIntakeDraft()
  const actor = ctx.actor()
  const saved = await storage.saveIntakeDraft({ id, inventoryId: inventory.id, header, content }, null, actor)
  if (!saved.saved) throw new ToolError('The intake could not be created. Try again.')
  const now = ctx.now().toISOString()
  const made: Intake = {
    id, inventoryId: inventory.id, status: 'draft', header, draft: content, lines: null, created: null, draftRev: saved.draftRev,
    createdAt: now, createdBy: actor.device, updatedAt: now, updatedBy: actor.device, committedAt: null,
  }
  return viewAfterSave(ctx, made, made, snapshot)
}

export async function updateIntakeHeader(
  ctx: ToolContext,
  args: { intake: string; shop?: string; orderNumber?: string; purchasedOn?: string; note?: string },
) {
  const storage = requireStorage(ctx)
  const { intake } = await locateIntake(ctx, args.intake)
  const header: IntakeHeader = {
    shop: args.shop === undefined ? intake.header.shop : field(args.shop),
    orderNumber: args.orderNumber === undefined ? intake.header.orderNumber : field(args.orderNumber),
    purchasedOn: args.purchasedOn === undefined ? intake.header.purchasedOn : checkDate(args.purchasedOn),
    note: args.note === undefined ? intake.header.note : field(args.note),
  }
  const saved = await storage.updateIntakeHeader(intake.id, header, ctx.actor())
  return viewAfterSave(ctx, intake, { header, draft: intake.draft, draftRev: saved.draftRev })
}


// ---- resolving what was typed -------------------------------------------------------------------------------------

/** Every folder a path can name: the stock's active folders and the draft's own, with their paths. */
function folderChoices(s: InventorySnapshot, draft: IntakeDraftContent): { id: Id; path: string }[] {
  const existing = s.folders.filter((f) => !folderArchived(s, f.id)).map((f) => ({ id: f.id, path: draftFolderPath(s, draft, f.id) })).filter((f) => f.path !== '')
  const own = (draft.newFolders ?? []).map((f) => ({ id: f.id, path: draftFolderPath(s, draft, f.id) }))
  return [...existing, ...own]
}

/** Folder by id or path ("Passives/Resistors", no case), also one this draft creates; empty is the root. */
function resolveFolder(s: InventorySnapshot, draft: IntakeDraftContent, text: string | undefined): Id | null {
  const wanted = text?.trim() ?? ''
  if (wanted === '') return null
  const choices = folderChoices(s, draft)
  const byId = choices.find((f) => f.id === wanted)
  if (byId) return byId.id
  const key = wanted.replace(/\s*\/\s*/g, '/').toLowerCase()
  const hits = choices.filter((f) => f.path.toLowerCase() === key)
  if (hits.length > 1) throw new ToolError(`"${wanted}" names more than one folder (ids ${hits.map((h) => h.id).join(', ')}): pass an id.`)
  if (hits.length === 1) return hits[0]!.id
  throw new ToolError(`No folder "${wanted}". Use an id or a path from get_overview or from the new folders of get_intake.`)
}

/** Unit by key, symbol or name among the built-in, the custom and this draft's own units; 'pcs' by default. */
function resolveUnitKey(s: InventorySnapshot, draft: IntakeDraftContent, text: string | undefined): string {
  const wanted = text?.trim() ?? ''
  if (wanted === '') return 'pcs'
  const choices = [...unitChoices(s), ...(draft.newUnits ?? []).map((u) => ({ key: customUnitKey(u.id), name: u.name, symbol: u.symbol, prefixPowers: u.prefixPowers }))]
  const hit =
    choices.find((u) => u.key === wanted) ?? choices.find((u) => u.symbol === wanted) ?? choices.find((u) => (u.key.startsWith('custom:') && same(u.key, wanted)) || same(u.name, wanted))
  if (!hit) throw new ToolError(`No unit "${wanted}". Units: ${choices.map((u) => u.symbol).join(', ')}. A new unit is declared as {name, symbol, prefixes}.`)
  return hit.key
}

function resolveAttribute(attrs: Attribute[], text: string): Attribute {
  const wanted = text.trim()
  const hit = attrs.find((a) => a.id === wanted) ?? attrs.find((a) => same(a.name, wanted))
  if (!hit) throw new ToolError(`No attribute "${wanted}". Attributes: ${attrs.map((a) => a.name).join(', ') || 'none'}. To make a new one, give its kind.`)
  return hit
}

/** An icon as typed: undefined when not passed, null when emptied. */
function iconOf(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined
  const t = text.trim()
  if (t === '') return null
  if (!isIconName(t)) throw new ToolError(`icon "${t}" is not an icon name: use a Lucide name in kebab-case, like "package" or "wrench".`)
  return t
}
/** A colour as typed: undefined when not passed, null when emptied; capitals. */
function colorOf(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined
  const t = text.trim().toUpperCase()
  if (t === '') return null
  if (!isColorHex(t)) throw new ToolError(`color "${text.trim()}" must look like #RRGGBB.`)
  return t
}

/** Powers of ten for prefixes given as symbols ("k", "M", "m", "µ"/"u"), names ("kilo") or powers (3). */
function prefixPowersOf(list: (string | number)[] | undefined): number[] {
  const out: number[] = []
  for (const x of list ?? []) {
    let power: number | undefined
    if (typeof x === 'number') power = x
    else {
      const t = x.trim() === 'u' ? 'µ' : x.trim()
      const hit = Object.entries(SI_PREFIXES).find(([, v]) => v.symbol === t || v.name === t.toLowerCase())
      power = hit ? Number(hit[0]) : undefined
    }
    if (power === undefined || !Object.hasOwn(SI_PREFIXES, power)) throw new ToolError(`"${String(x)}" is not an SI prefix: use symbols like k, M, m, µ or powers of ten like 3, -3.`)
    if (!out.includes(power)) out.push(power)
  }
  return out
}

const KIND: Record<NonNullable<AttributeArg['kind']>, AttributeKind> = { number: 'number', list: 'enum', text: 'text' }

/** A new attribute as the draft keeps it. */
function newAttributeOf(id: Id, a: AttributeArg): DraftNewAttribute {
  const kind = KIND[a.kind!]
  if (!kind) throw new ToolError(`Attribute kind "${String(a.kind)}" is not one of number, list, text.`)
  const options = (a.options ?? []).map((o) => o.trim()).filter((o) => o !== '')
  if (kind === 'enum' && options.length === 0) throw new ToolError(`List attribute "${a.attribute}" needs at least one option: pass options.`)
  return {
    id,
    name: a.attribute ?? '',
    kind,
    unit: kind === 'number' ? (a.unit ?? '').trim() : '',
    siPrefixes: kind === 'number' && a.siPrefixes === true,
    options: kind === 'enum' ? options : [],
    ...(a.pinned === true ? { pinned: true } : {}),
  }
}

/** The ids a call needs for what it makes, fixed for the whole call: editDraft may run the edit twice. */
function minter(): (key: string) => Id {
  const made = new Map<string, Id>()
  return (key) => {
    let id = made.get(key)
    if (!id) made.set(key, (id = newId()))
    return id
  }
}

const describe = (key: string, params?: Record<string, string>) => messageFor(key, params)

/** The axes (attribute ids) of an item, existing or new. */
function axesOf(s: InventorySnapshot, attrs: Attribute[], newItem: DraftNewItem | null, itemId: Id): Attribute[] {
  if (!newItem) return itemAxes(s, itemId)
  return newItem.attributes.flatMap((x) => (x.axis ? attrs.filter((a) => a.id === x.attributeId) : []))
}

/** Typed `values` (attribute id or name -> text) as axis values; a key that is not an axis of the item is refused. */
function resolveValues(attrs: Attribute[], axes: Attribute[], values: Record<string, string> | undefined): { attributeId: Id; value: string }[] {
  const out: { attributeId: Id; value: string }[] = []
  for (const [key, value] of Object.entries(values ?? {})) {
    const a = axes.find((x) => x.id === key.trim() || same(x.name, key))
    if (!a) {
      const known = attrs.some((x) => x.id === key.trim() || same(x.name, key))
      throw new ToolError(
        known
          ? `"${key}" is not a variant attribute of this item${axes.length ? ` (its variant attributes: ${axes.map((x) => x.name).join(', ')})` : ' (it has none)'}.`
          : `No attribute "${key}".`,
      )
    }
    out.push({ attributeId: a.id, value: String(value) })
  }
  return out
}

const problems = (list: string[]): ToolError => new ToolError(`Nothing was saved.\n${list.join('\n')}`)

/** Runs `step`, turning a refusal into one problem line instead of stopping. */
function collect(errors: string[], label: string, step: () => void): void {
  try {
    step()
  } catch (e) {
    if (!(e instanceof ToolError)) throw e
    errors.push(`${label}: ${e.message}`)
  }
}

/** A kit refusal as text. `alreadyCreated` names the other line by its number and id; a duplicate names the one that exists (id, path). */
function refusal(key: string, params: Record<string, string> | undefined, s: InventorySnapshot, draft: IntakeDraftContent): string {
  const text = describe(key, params)
  if (key === 'intakes.line.alreadyCreated' && params?.line) {
    const n = draft.lines.findIndex((l) => l.id === params.line)
    return `${text} That is ${n >= 0 ? `line ${n + 1} (id ${params.line})` : `line ${params.line}`}.`
  }
  if ((key === 'intakes.folder.duplicate' || key === 'intakes.folder.duplicateArchived') && params?.id) {
    const path = draftFolderPath(s, draft, params.id)
    return `${text} It is ${path ? `"${path}" ` : ''}(id ${params.id})${key === 'intakes.folder.duplicate' ? '; use it, or pick another name' : ''}.`
  }
  if (key === 'intakes.attribute.duplicate' && params?.id) {
    const name = draftAttributes(s, draft).find((a) => a.id === params.id)?.name
    return `${text} It is ${name ? `"${name}" ` : ''}(id ${params.id}); use it by name, or pick another name.`
  }
  if (key === 'intakes.unit.duplicate' && params?.id) {
    const unit = intakeUnits(draft, s)
    const hit = unitChoices(s).find((u) => u.key === params.id) ?? (draft.newUnits ?? []).find((u) => u.id === params.id)
    return `${text} It is ${hit ? `"${hit.name}" (${hit.symbol}) ` : ''}(${unit.some((u) => u.id === params.id) ? 'id' : 'key'} ${params.id}); use it by its symbol, or pick another name.`
  }
  return text
}
const failed = (r: IntakeDraftContent | DraftError, s: InventorySnapshot, draft: IntakeDraftContent): IntakeDraftContent => {
  if ('errorKey' in r) throw new ToolError(refusal(r.errorKey, r.params, s, draft))
  return r
}

/** An item whose name an item of its folder (living or archived) or another new item already has is refused, naming the one that exists. */
function refuseTwin(s: InventorySnapshot, draft: IntakeDraftContent, item: { id: Id; name: string; folderId: Id | null }): void {
  const clash = nameClash(s, draft, { kind: 'item', name: item.name, folderId: item.folderId }, item.id)
  if (!clash) return
  const where = draftFolderPath(s, draft, item.folderId) || 'the root'
  const name = (clash.draft ? draft.newItems.find((n) => n.id === clash.id) : s.items.find((i) => i.id === clash.id))?.name ?? item.name
  if (clash.draft) throw new ToolError(`Another new item of this intake is already named "${name}" in "${where}" (id ${clash.id}): add lines to it, or choose another name.`)
  throw new ToolError(
    clash.archived
      ? `An archived item "${name}" (id ${clash.id}) is in "${where}": restore it in the app, or choose another name.`
      : `An item "${name}" already exists in "${where}" (id ${clash.id}): top it up with a line (item: "${clash.id}"), or choose another name.`,
  )
}

/**
 * Refuses a change that leaves a line or an entity (folder, unit, attribute, tag, list value, new item) with a problem it
 * did not have before: the checks that only run inside buildDraftLine do not cover an item without lines, an item whose
 * lines stay, or an attribute that lines already use. A problem that was already there is not this call's and does not
 * block it.
 */
function refuseNewProblems(before: IntakeDraftContent, after: IntakeDraftContent, s: InventorySnapshot): void {
  const was = resolveIntake(before, s)
  const now = resolveIntake(after, s)
  const nameOf = entityNamer(s, after)
  const list: string[] = []
  now.lines.forEach((l, i) => {
    if (l.resolution.kind !== 'problem') return
    const had = was.lines.find((x) => x.lineId === l.lineId)
    if (had && had.resolution.kind === 'problem') return
    list.push(`line ${i + 1}: ${problemText(l.resolution.code)}.`)
  })
  for (const e of now.entities) {
    if (e.problem === null || was.entities.some((x) => x.kind === e.kind && x.id === e.id && x.problem !== null)) continue
    const label = e.kind === 'item' ? `new item "${after.newItems.find((n) => n.id === e.id)?.name ?? e.id}"` : `new ${e.kind === 'option' ? 'list value of' : e.kind} ${nameOf(e.id)}`
    list.push(`${label}: ${entityProblemText(e.problem, e.kind, nameOf) ?? 'has a problem'}.`)
  }
  if (list.length > 0) throw problems(list)
}

/** A value a call added to a list, to be found in the draft afterwards: nothing may be added that nothing uses. */
interface Staged {
  label: string
  attributeId: Id
  name: string
  value: string
}

/** The draft with the values added to lists; a value of an existing list is staged (kept until a line or item uses it), one of a list this draft declares is appended to its options; refuses a list that has the value (no case) and a non-list. */
function stageValues(s: InventorySnapshot, draft: IntakeDraftContent, list: ValueArg[] | undefined, staged: Staged[], label: string): IntakeDraftContent {
  let out = draft
  for (const v of list ?? []) {
    const a = resolveAttribute(draftAttributes(s, out), v.attribute ?? '')
    const value = String(v.value ?? '').trim()
    const own = s.attributes.find((x) => x.id === a.id)
    const mine = own ? undefined : (out.newAttributes ?? []).find((x) => x.id === a.id)
    const target = own ?? mine!
    if (target.kind !== 'enum') throw new ToolError(`"${target.name}" is not a list attribute (it is ${target.kind === 'number' ? 'a number' : 'a text'}): values are added to lists only.`)
    const have = target.options.find((o) => same(o, value))
    if (have !== undefined) throw new ToolError(`The list "${target.name}" (id ${target.id}) already has "${have}": use it as it is, do not add it.`)
    if (mine) {
      out = failed(withNewAttribute(out, s, { ...mine, options: [...mine.options, value] }), s, out)
      continue
    }
    out = failed(withAddedOption(out, s, a.id, value), s, out)
    staged.push({ label, attributeId: a.id, name: a.name, value })
  }
  return out
}

/** The staged values put back: building an item or a line prunes the ones no line uses yet, and the next step still needs them. */
function restage(s: InventorySnapshot, draft: IntakeDraftContent, staged: Staged[]): IntakeDraftContent {
  let out = draft
  for (const x of staged) out = failed(withAddedOption(out, s, x.attributeId, x.value), s, out)
  return out
}

/** Problem lines for added values the finished draft no longer holds (the draft keeps only what a line or an item uses). */
function unusedStaged(draft: IntakeDraftContent, staged: Staged[]): string[] {
  return staged.flatMap((x) =>
    draft.addedOptions?.find((o) => o.attributeId === x.attributeId)?.values.some((v) => same(v, x.value))
      ? []
      : [`${x.label}: "${x.value}" was added to the list "${x.name}" but nothing in this draft uses it: give it as a value of a line, or as a value of the new item.`],
  )
}

/**
 * A new item put in the draft with what it declares. Existing attributes (and those of the draft) and tags are kept as
 * they are; new ones, a new unit, and values added to lists are declared under it, so what nothing uses is pruned.
 * `decl.attributes`, `.tags`, `.unit` that are not passed leave the item's own as they are (`base`). Refuses a bad name,
 * icon, colour, prefix, and (when `check`) an item name its folder already has.
 */
function placeItem(a: { s: InventorySnapshot; draft: IntakeDraftContent; base: DraftNewItem; decl: ItemDeclarations; key: string; label: string; mint: (key: string) => Id; staged: Staged[]; check: boolean }): IntakeDraftContent {
  const { s, draft, decl, mint } = a
  const name = a.base.name.trim()
  if (name === '') throw new ToolError(describe('errors.domain.name_required'))
  if (name.length > MAX_NAME_LENGTH) throw new ToolError(describe('errors.domain.name_too_long'))
  const item: DraftNewItem = { ...a.base, name }
  if (a.check) refuseTwin(s, draft, item)
  const icon = iconOf(decl.icon)
  if (icon !== undefined) item.icon = icon
  const color = colorOf(decl.color)
  if (color !== undefined) item.color = color
  let unit: { id?: Id; name: string; symbol: string; prefixPowers: number[] } | null = null
  if (typeof decl.unit === 'string') item.unitKey = resolveUnitKey(s, draft, decl.unit)
  else if (decl.unit) {
    const uname = (decl.unit.name ?? '').trim()
    // A unit this draft has under that name is the one being declared again (its symbol or prefixes may be corrected).
    const mine = (draft.newUnits ?? []).find((u) => same(u.name, uname))
    unit = { ...(mine ? { id: mine.id } : {}), name: decl.unit.name ?? '', symbol: decl.unit.symbol ?? '', prefixPowers: prefixPowersOf(decl.unit.prefixes) }
  }

  const defs: { def: DraftNewAttribute; axis: boolean; value: string | null }[] = []
  if (decl.attributes !== undefined) {
    const known = draftAttributes(s, draft)
    const seen = new Set<string>()
    const shared: DraftNewItem['attributes'] = []
    const axes: DraftNewItem['attributes'] = []
    decl.attributes.forEach((x, k) => {
      const once = (label: string) => {
        if (seen.has(label.toLowerCase())) throw new ToolError(`Attribute "${label}" is listed twice.`)
        seen.add(label.toLowerCase())
      }
      if (x.axis === true && field(x.value) !== null) throw new ToolError(`Attribute "${x.attribute ?? ''}" is a variant attribute (axis: true): each line gives its value, so the item has none. Drop value, or drop axis.`)
      if (x.kind !== undefined) {
        once(x.attribute ?? '')
        // An attribute this draft declares (same name, no case) is declared again: the same one, changed.
        const mine = (draft.newAttributes ?? []).find((n) => same(n.name, (x.attribute ?? '').trim()))
        if (!mine) {
          defs.push({ def: newAttributeOf(mint(`${a.key}:attr:${k}`), x), axis: x.axis === true, value: field(x.value) })
          return
        }
        const kindWas = (Object.keys(KIND) as (keyof typeof KIND)[]).find((key) => KIND[key] === mine.kind)!
        const declarer = draft.newItems.find((n) => n.id !== item.id && n.attributes.some((y) => y.attributeId === mine.id)) ?? draft.newItems.find((n) => n.attributes.some((y) => y.attributeId === mine.id))
        const lineUses = draft.lines.some((l) => l.axisValues.some((v) => v.attributeId === mine.id))
        const elsewhere = draft.newItems.some((n) => n.id !== item.id && n.attributes.some((y) => y.attributeId === mine.id)) || lineUses
        const who = `${mine.name} is already declared${declarer ? ` by ${declarer.name}` : ''} as ${kindWas === 'list' ? 'a list' : `a ${kindWas}`}`
        if (x.kind !== kindWas && elsewhere) throw new ToolError(`${who}; use it as it is (without kind) or change it there.`)
        // What the redeclaration leaves out stays as the draft has it.
        const merged: AttributeArg = {
          ...x,
          unit: x.unit ?? mine.unit,
          siPrefixes: x.siPrefixes ?? mine.siPrefixes,
          options: x.options ?? mine.options,
          pinned: x.pinned ?? mine.pinned ?? false,
        }
        const def = newAttributeOf(mine.id, merged)
        if (def.kind === 'enum') {
          const used = new Set(draft.lines.flatMap((l) => l.axisValues.filter((v) => v.attributeId === mine.id).map((v) => v.value.trim().toLowerCase())))
          const lost = mine.options.find((o) => used.has(o.trim().toLowerCase()) && !def.options.some((q) => same(q, o)))
          if (lost !== undefined) throw new ToolError(`${who}; its option "${lost}" is used by a line, so it stays: keep it in options.`)
        }
        defs.push({ def, axis: x.axis === true, value: field(x.value) })
        return
      }
      const found = resolveAttribute(known, x.attribute ?? '')
      once(found.name)
      if (x.axis) axes.push({ attributeId: found.id, value: null, axis: true })
      else shared.push({ attributeId: found.id, value: field(x.value), axis: false })
    })
    item.attributes = [...shared, ...axes]
  }

  const fresh: { name: string; color: string | null | undefined }[] = []
  if (decl.tags !== undefined) {
    const ids: Id[] = []
    for (const t of decl.tags) {
      const text = (typeof t === 'string' ? t : (t.name ?? '')).trim()
      if (text === '') continue
      const tint = typeof t === 'string' ? undefined : colorOf(t.color)
      const hit = s.tags.find((x) => x.id === text)?.id ?? s.tags.find((x) => same(x.name, text))?.id ?? (draft.newTags ?? []).find((x) => x.id === text || same(x.name, text))?.id
      if (hit) {
        if (!ids.includes(hit)) ids.push(hit)
      } else if (!fresh.some((f) => same(f.name, text))) fresh.push({ name: text, color: tint })
    }
    item.tagIds = ids
  }

  let out = withNewItem(draft, item)
  for (const d of defs) out = failed(withItemAttribute(out, s, item.id, d.def, { axis: d.axis, value: d.value }), s, out)
  for (const t of fresh) out = failed(withItemTag(out, s, item.id, t.name, t.color ?? undefined), s, out)
  if (unit) out = failed(withItemUnit(out, s, item.id, unit), s, out)
  // Shared attributes first, then the variant attributes, as the app lists them; tags in the order they were typed.
  const placed = out.newItems.find((n) => n.id === item.id)!
  const attributes = [...placed.attributes.filter((x) => !x.axis), ...placed.attributes.filter((x) => x.axis)]
  const typedTags = (decl.tags ?? []).flatMap((t) => {
    const text = (typeof t === 'string' ? t : (t.name ?? '')).trim()
    const id = [...s.tags, ...(out.newTags ?? [])].find((x) => x.id === text || same(x.name, text))?.id
    return id ? [id] : []
  })
  const tagIds = decl.tags === undefined ? placed.tagIds : [...new Set(typedTags)]
  out = { ...out, newItems: out.newItems.map((n) => (n.id === item.id ? { ...placed, attributes, tagIds } : n)) }
  return restage(s, stageValues(s, out, decl.addValues, a.staged, a.label), a.staged)
}

/** Changes a draft and tells which of its names are new, with the names they look like. */
async function editAdvised(ctx: ToolContext, intakeId: Id, edit: Parameters<typeof editDraft>[2]) {
  let similar: SimilarEntry[] = []
  const view = await editDraft(ctx, intakeId, (draft, header, s) => {
    const result = edit(draft, header, s)
    similar = similarOf(s, draft, result.draft)
    return result
  })
  return { ...view, similar }
}

/** A picture that stands in for the upload while an edit is only being checked. */
const STAND_IN_FILE: PhotoFile = { provider: 'dry', fileId: 'dry', url: 'dry', urls: null, deleteHandle: null, width: 1, height: 1 }
/** Stand-ins for a list of paths: each its own file, so the checks see as many photos as will be uploaded. */
const standIns = (paths: string[]): PhotoFile[] => paths.map((_, j) => ({ ...STAND_IN_FILE, fileId: `dry${j}` }))

/** The paths of an item's `photos`, trimmed. More than the draft holds, or a blank path, is refused here, before anything is uploaded. */
function photoPaths(label: string, photos: string[] | undefined): string[] {
  const paths = (photos ?? []).map((p) => (typeof p === 'string' ? p.trim() : ''))
  if (paths.length > MAX_DRAFT_ITEM_PHOTOS) throw new ToolError(`${label}: at most ${MAX_DRAFT_ITEM_PHOTOS} photos per new item (got ${paths.length}).`)
  if (paths.some((p) => !p)) throw new ToolError(`${label}: a photo path is empty.`)
  return paths
}

/** The files as the item's gallery: in order, a file given twice kept once; a file the item already has keeps its id (`old`). */
function gallery(files: PhotoFile[], ids: Id[], old: DraftItemPhoto[] = []): DraftItemPhoto[] {
  const out: DraftItemPhoto[] = []
  files.forEach((file, j) => {
    if (out.some((p) => p.provider === file.provider && p.fileId === file.fileId)) return
    const had = old.find((p) => p.provider === file.provider && p.fileId === file.fileId)
    out.push({ ...file, id: had?.id ?? ids[j]! })
  })
  return out
}
const STAND_IN: DraftLinePhoto = { ...STAND_IN_FILE, replace: false }

/** Runs `edit` against the draft as the database holds it now, writing nothing: the refusals that need no I/O, before an upload. */
async function dryRun(
  ctx: ToolContext,
  intakeId: Id,
  edit: (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => unknown,
): Promise<void> {
  const { inventory, intake } = await locateIntake(ctx, intakeId)
  assertDraft(intake)
  edit(intake.draft, intake.header, await requireSource(ctx).snapshot(inventory.id))
}

// ---- add ----------------------------------------------------------------------------------------------------------

export async function addIntakeLines(ctx: ToolContext, args: { intake: string; newItems?: NewItemArgs[]; lines?: LineArgs[] }) {
  const lines = args.lines ?? []
  const newItems = args.newItems ?? []
  if (lines.length === 0 && !newItems.some((n) => n.withoutLines)) throw new ToolError('Pass at least one line, or a new item with withoutLines: true.')
  // The ids are fixed here: editDraft may run its callback twice, and neither may mint new ones. Uploads happen after the dry run below.
  const lineIds = lines.map(() => newId())
  const itemIds = newItems.map(() => newId())
  const itemPhotoPaths = newItems.map((n, i) => photoPaths(`new item ${i + 1}`, n.photos))
  const itemPhotoIds = itemPhotoPaths.map((paths) => paths.map(() => newId()))
  const mint = minter()
  const build = (photos: (DraftLinePhoto | null)[], itemPhotos: PhotoFile[][]) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const errors: string[] = []
    const staged: Staged[] = []
    const fresh = new Map<string, { id: Id; withoutLines: boolean }>()
    let next = draft
    newItems.forEach((n, i) => {
      collect(errors, `new item ${i + 1}`, () => {
        const ref = n.ref?.trim()
        if (!ref) throw new ToolError('"ref" is required: the name lines use to point at this new item.')
        if (fresh.has(ref)) throw new ToolError(`ref "${ref}" is used twice.`)
        const own = gallery(itemPhotos[i] ?? [], itemPhotoIds[i]!)
        const base: DraftNewItem = {
          id: itemIds[i]!,
          name: n.name ?? '',
          folderId: resolveFolder(s, next, n.folder),
          unitKey: 'pcs',
          attributes: [],
          tagIds: [],
          description: field(n.description),
          ...(own.length > 0 ? { photos: own } : {}),
        }
        next = placeItem({ s, draft: next, base, decl: n, key: `item${i}`, label: `new item ${i + 1}`, mint, staged, check: true })
        fresh.set(ref, { id: itemIds[i]!, withoutLines: n.withoutLines === true })
      })
    })

    const used = new Set<string>()
    lines.forEach((l, i) => {
      collect(errors, `line ${i + 1}`, () => {
        const ref = l.item?.trim() ?? ''
        const made = fresh.get(ref)
        if (made) used.add(ref)
        const newItem = next.newItems.find((n) => n.id === (made?.id ?? ref)) ?? null
        const existing = newItem ? undefined : s.items.find((x) => x.id === ref)
        if (!newItem) {
          if (!existing) throw new ToolError(`No item "${ref}": use an item id from search, the id of a new item of this intake, or the ref of a new item of this call.`)
          if (itemArchived(s, existing)) throw new ToolError(`"${existing.name}" is archived.`)
        }
        const working = stageValues(s, restage(s, next, staged), l.addValues, staged, `line ${i + 1}`)
        const attrs = draftAttributes(s, working)
        const itemId = newItem?.id ?? existing!.id
        const axes = axesOf(s, attrs, newItem, itemId)
        const axisValues = resolveValues(attrs, axes, l.values)
        const built = buildDraftLine(
          {
            lineId: lineIds[i]!,
            ids: { movementId: newId(), variantId: newId(), photoId: newId() },
            itemId,
            newItem,
            axisValues,
            amount: l.amount ?? '',
            price: l.price ?? '',
            url: l.url ?? '',
            urlPrefix: null,
            photo: photos[i] ?? null,
            newTags: working.newTags ?? [],
            variantDescription: l.description,
          },
          s,
          working,
        )
        if ('errorKey' in built) throw new ToolError(refusal(built.errorKey, built.params, s, working))
        if (field(l.description) !== null && built.line.variantDescription === undefined) throw new ToolError(NO_VARIANT)
        next = restage(s, withLine(working, built.line, built.newItem, built.newTags), staged)
      })
    })
    if (errors.length > 0) throw problems(errors)
    // A new item lives on its own; one that no line uses and that was not asked for without lines is a slip.
    const unused: string[] = []
    for (const [ref, f] of fresh) if (!used.has(ref) && !f.withoutLines) unused.push(`new item "${ref}": no line uses it (pass withoutLines: true to make it with no stock).`)
    if (unused.length > 0) throw problems(unused)
    next = pruneDraft(next)
    const idle = unusedStaged(next, staged)
    if (idle.length > 0) throw problems(idle)
    refuseNewProblems(draft, next, s)
    return { draft: next, header }
  }
  // Refusals that need no I/O come before any upload: the same checks, run on stand-in photos against what the database holds now.
  if (lines.some((l) => l.photo?.trim()) || itemPhotoPaths.some((p) => p.length > 0)) {
    await dryRun(ctx, args.intake, build(
      lines.map((l) => (l.photo?.trim() ? STAND_IN : null)),
      itemPhotoPaths.map(standIns),
    ))
  }
  const check = async (label: string, path: string | undefined) => {
    if (!path?.trim()) return
    try {
      await checkPhoto(ctx, path.trim())
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`${label}: ${e.message}`)
      throw e
    }
  }
  // Every file is looked at before the first upload: a bad later path refuses with nothing uploaded.
  for (const [i, paths] of itemPhotoPaths.entries()) for (const [j, path] of paths.entries()) await check(`new item ${i + 1} photo ${j + 1}`, path)
  for (const [i, l] of lines.entries()) await check(`line ${i + 1}`, l.photo)
  const photos: (DraftLinePhoto | null)[] = []
  const itemPhotos: PhotoFile[][] = []
  const upload = async (label: string, path: string | undefined): Promise<DraftLinePhoto | null> => {
    const file = path?.trim()
    if (!file) return null
    try {
      return await attachPhoto(ctx, file)
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`${label}: ${e.message}`)
      throw e
    }
  }
  for (const [i, paths] of itemPhotoPaths.entries()) {
    const files: PhotoFile[] = []
    for (const [j, path] of paths.entries()) files.push(fileOnly((await upload(`new item ${i + 1} photo ${j + 1}`, path))!))
    itemPhotos.push(files)
  }
  for (const [i, l] of lines.entries()) {
    const p = await upload(`line ${i + 1}`, l.photo)
    photos.push(p)
  }
  const view = await editAdvised(ctx, args.intake, build(photos, itemPhotos))
  // Only a saved line or item makes its picture "used".
  const warning = markPhotosUsed(ctx, [
    ...lines.flatMap((l, i) => (photos[i] ? [{ file: l.photo!.trim(), intakeId: args.intake.trim(), lineId: lineIds[i]! }] : [])),
    // Each gallery photo is marked with its own id; a file given twice in a list is one photo.
    ...newItems.flatMap((_, i) => {
      const placed = gallery(itemPhotos[i]!, itemPhotoIds[i]!)
      return placed.map((p) => ({ file: itemPhotoPaths[i]![itemPhotos[i]!.findIndex((f) => f.provider === p.provider && f.fileId === p.fileId)]!, intakeId: args.intake.trim(), lineId: p.id }))
    }),
  ])
  return warning ? { ...view, warning } : view
}

const NO_VARIANT = 'a description belongs to a line that makes a new variant (a new value of a variant attribute); this line makes none.'

// ---- edit and remove ----------------------------------------------------------------------------------------------

function findLine(draft: IntakeDraftContent, id: string): DraftLine {
  const line = draft.lines.find((l) => l.id === id.trim())
  if (!line) throw new ToolError(`No line "${id}" in this intake. Line ids are in get_intake.`)
  return line
}

export async function updateIntakeLine(
  ctx: ToolContext,
  args: { intake: string; line: string; values?: Record<string, string>; amount?: string; price?: string; url?: string; photo?: string; addValues?: ValueArg[]; description?: string },
) {
  const path = args.photo?.trim()
  const build = (uploaded: DraftLinePhoto | null) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const old = findLine(draft, args.line)
    const staged: Staged[] = []
    const working = stageValues(s, draft, args.addValues, staged, 'line')
    const newItem = working.newItems.find((n) => n.id === old.itemId) ?? null
    const attrs = draftAttributes(s, working)
    const axes = axesOf(s, attrs, newItem, old.itemId)
    const typed = resolveValues(attrs, axes, args.values)
    const axisValues = [...old.axisValues.filter((v) => !typed.some((t) => t.attributeId === v.attributeId)), ...typed]
    // What is not changed is kept as it is, not read again: a link or a unit that no longer fits does not block an edit of the amount.
    const built = buildDraftLine(
      {
        lineId: old.id,
        ids: old.ids,
        itemId: old.itemId,
        newItem,
        axisValues,
        amount: args.amount ?? '1',
        price: args.price ?? '',
        url: args.url ?? '',
        urlPrefix: null,
        photo: uploaded ?? (args.photo !== undefined ? null : old.photo),
        newTags: working.newTags ?? [],
        variantDescription: args.description === undefined ? old.variantDescription : args.description,
      },
      s,
      working,
    )
    if ('errorKey' in built) throw new ToolError(`line: ${refusal(built.errorKey, built.params, s, working)}`)
    if (field(args.description) !== null && built.line.variantDescription === undefined) throw new ToolError(`line: ${NO_VARIANT}`)
    const line: DraftLine = {
      ...built.line,
      quantity: args.amount === undefined ? old.quantity : built.line.quantity,
      totalPrice: args.price === undefined ? old.totalPrice : built.line.totalPrice,
      sourceUrl: args.url === undefined ? old.sourceUrl : built.line.sourceUrl,
    }
    const next = pruneDraft(withLine(working, line, built.newItem, built.newTags))
    const idle = unusedStaged(next, staged)
    if (idle.length > 0) throw problems(idle)
    return { draft: next, header }
  }
  // Refusals that need no I/O come before the upload: the same edit, run with a stand-in photo on what the database holds now.
  if (path) await dryRun(ctx, args.intake, build(STAND_IN))
  const uploaded = path ? await attachPhoto(ctx, path) : null
  const view = await editAdvised(ctx, args.intake, build(uploaded))
  const warning = path && uploaded ? markPhotosUsed(ctx, [{ file: path, intakeId: args.intake.trim(), lineId: args.line.trim() }]) : null
  return warning ? { ...view, warning } : view
}

export async function removeIntakeLine(ctx: ToolContext, args: { intake: string; line: string }) {
  return editDraft(ctx, args.intake, (draft, header) => {
    const line = findLine(draft, args.line)
    // The new item stays (it lives on its own); what only the line used (a new tag, a value added to a list) goes.
    return { draft: pruneDraft({ ...draft, lines: draft.lines.filter((l) => l.id !== line.id) }), header }
  })
}

function findNewItem(draft: IntakeDraftContent, text: string): DraftNewItem {
  const old = draft.newItems.find((n) => n.id === text.trim())
  if (!old) throw new ToolError(`No new item "${text}" in this intake. New item ids are in get_intake; an item that is already in stock is not changed here.`)
  return old
}

export async function updateNewItem(
  ctx: ToolContext,
  args: ItemDeclarations & {
    intake: string
    item: string
    name?: string
    description?: string
    folder?: string
    /** Picture paths from list_photos, in order (the first is the cover): replaces the whole list; [] removes all; left out: unchanged. */
    photos?: string[]
  },
) {
  const paths = args.photos === undefined ? null : photoPaths('item', args.photos)
  const photoIds = (paths ?? []).map(() => newId())
  const mint = minter()
  let seenPhotos: DraftItemPhoto[] = []
  const build = (files: PhotoFile[] | null) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const id = args.item.trim()
    const old = findNewItem(draft, id)
    const { photos: oldPhotos, ...rest } = old
    seenPhotos = oldPhotos ?? []
    const base: DraftNewItem = {
      ...rest,
      name: args.name === undefined ? old.name : args.name,
      description: args.description === undefined ? old.description : field(args.description),
      folderId: args.folder === undefined ? old.folderId : resolveFolder(s, draft, args.folder),
      ...(files === null ? (oldPhotos?.length ? { photos: oldPhotos } : {}) : files.length > 0 ? { photos: gallery(files, photoIds, oldPhotos) } : {}),
    }
    const staged: Staged[] = []
    const errors: string[] = []
    let placed = draft
    collect(errors, 'item', () => {
      const moved = base.name.trim() !== old.name.trim() || base.folderId !== old.folderId
      placed = placeItem({ s, draft, base, decl: args, key: 'item', label: 'item', mint, staged, check: moved })
    })
    if (errors.length > 0) throw problems(errors)
    const item = placed.newItems.find((n) => n.id === id)!
    const axisIds = new Set(item.attributes.filter((x) => x.axis).map((x) => x.attributeId))
    // Every line of the item is checked again against the changed item (a new variant attribute needs a value on each).
    let lines = placed.lines
    placed.lines.forEach((old, i) => {
      if (old.itemId !== id) return
      const built = buildDraftLine(
        {
          lineId: old.id,
          ids: old.ids,
          itemId: id,
          newItem: item,
          axisValues: old.axisValues.filter((v) => axisIds.has(v.attributeId)),
          amount: '1',
          price: '',
          url: '',
          urlPrefix: null,
          photo: null,
          newTags: placed.newTags ?? [],
        },
        s,
        placed,
      )
      if ('errorKey' in built) errors.push(`line ${i + 1}: ${refusal(built.errorKey, built.params, s, placed)}`)
      else lines = lines.map((l) => (l.id === old.id ? { ...old, axisValues: built.line.axisValues } : l))
    })
    if (errors.length > 0) throw problems(errors)
    const next = pruneDraft({ ...placed, lines })
    const idle = unusedStaged(next, staged)
    if (idle.length > 0) throw problems(idle)
    refuseNewProblems(draft, next, s)
    return { draft: next, header }
  }
  // Refusals that need no I/O come before the upload: the same edit, run with a stand-in photo on what the database holds now.
  if (paths && paths.length > 0) await dryRun(ctx, args.intake, build(standIns(paths)))
  for (const [j, path] of (paths ?? []).entries()) {
    try {
      await checkPhoto(ctx, path)
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`photo ${j + 1}: ${e.message}`)
      throw e
    }
  }
  let files: PhotoFile[] | null = null
  if (paths) {
    files = []
    for (const [j, path] of paths.entries()) {
      try {
        files.push(fileOnly(await attachPhoto(ctx, path)))
      } catch (e) {
        if (e instanceof ToolError) throw new ToolError(`photo ${j + 1}: ${e.message}`)
        throw e
      }
    }
  }
  const view = await editAdvised(ctx, args.intake, build(files))
  const warning = paths && files && files.length > 0
    ? markPhotosUsed(ctx, gallery(files, photoIds, seenPhotos).map((p) => ({ file: paths[files.findIndex((f) => f.provider === p.provider && f.fileId === p.fileId)]!, intakeId: args.intake.trim(), lineId: p.id })))
    : null
  return warning ? { ...view, warning } : view
}

export async function removeNewItem(ctx: ToolContext, args: { intake: string; item: string }) {
  return editDraft(ctx, args.intake, (draft, header) => {
    const old = findNewItem(draft, args.item)
    return { draft: withoutNewItem(draft, old.id).content, header }
  })
}

// ---- draft folders ------------------------------------------------------------------------------------------------

function findNewFolder(s: InventorySnapshot, draft: IntakeDraftContent, text: string): DraftNewFolder {
  const wanted = text.trim()
  const key = wanted.replace(/\s*\/\s*/g, '/').toLowerCase()
  const own = draft.newFolders ?? []
  const hit = own.find((f) => f.id === wanted) ?? own.find((f) => draftFolderPath(s, draft, f.id).toLowerCase() === key)
  if (!hit) throw new ToolError(`No new folder "${text}" in this intake: folders already in stock are not changed here. New folders are in get_intake.`)
  return hit
}

export async function createFolder(ctx: ToolContext, args: { intake: string; name: string; parent?: string; icon?: string }) {
  const id = newId()
  return editAdvised(ctx, args.intake, (draft, header, s) => {
    const parentId = resolveFolder(s, draft, args.parent)
    const icon = iconOf(args.icon)
    return { draft: failed(withNewFolder(draft, s, { id, name: args.name ?? '', parentId, ...(icon ? { icon } : {}) }), s, draft), header }
  })
}

export async function updateFolder(ctx: ToolContext, args: { intake: string; folder: string; name?: string; parent?: string; icon?: string }) {
  return editAdvised(ctx, args.intake, (draft, header, s) => {
    const old = findNewFolder(s, draft, args.folder)
    const icon = iconOf(args.icon)
    const next: DraftNewFolder = {
      ...old,
      name: args.name === undefined ? old.name : args.name,
      parentId: args.parent === undefined ? old.parentId : resolveFolder(s, draft, args.parent),
      ...(icon !== undefined ? { icon } : {}),
    }
    return { draft: failed(withNewFolder(draft, s, next), s, draft), header }
  })
}

export async function removeFolder(ctx: ToolContext, args: { intake: string; folder: string }) {
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const old = findNewFolder(s, draft, args.folder)
    return { draft: failed(withoutNewFolder(draft, old.id), s, draft), header }
  })
}
