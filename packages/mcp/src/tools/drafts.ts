import {
  emptyIntakeDraft,
  itemArchived,
  itemAxes,
  newId,
  pruneNewItems,
  type Attribute,
  type DraftLine,
  type DraftLinePhoto,
  type DraftNewItem,
  type DraftNewTag,
  type Id,
  type IntakeDraftContent,
  type IntakeHeader,
  type InventorySnapshot,
} from '@antresol/core'
import { buildDraftLine, unitChoices, withLine } from '@antresol/kit'
import { requireStorage, requireSource, resolveInventory, type ToolContext } from '../context'
import { editDraft, locateIntake, viewOf } from '../draft-edit'
import { ToolError } from '../errors'
import { messageFor } from '../messages'
import { folderPath } from '../shape'
import { attachPhoto, markPhotoUsed } from './photos'

export interface NewItemArgs {
  ref: string
  name: string
  /** Folder id or path. */
  folder?: string
  /** Unit key, symbol or name; 'pcs' by default. */
  unit?: string
  attributes?: { attribute: string; value?: string; axis?: boolean }[]
  /** Tag ids or names; an unknown name is a new tag. */
  tags?: string[]
}
export interface LineArgs {
  /** An item id, the id of a new item of the draft, or the `ref` of a new item of this call. */
  item: string
  values?: Record<string, string>
  amount: string
  price?: string
  url?: string
  photo?: string
  replacePhoto?: boolean
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
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
  const { inventory } = await resolveInventory(ctx, args.inventory)
  const header: IntakeHeader = {
    shop: field(args.shop),
    orderNumber: field(args.orderNumber),
    purchasedOn: args.purchasedOn?.trim() ? checkDate(args.purchasedOn) : today(ctx),
    note: field(args.note),
  }
  const id = newId()
  const saved = await storage.saveIntakeDraft({ id, inventoryId: inventory.id, header, content: emptyIntakeDraft() }, null, ctx.actor())
  if (!saved.saved) throw new ToolError('The intake could not be created. Try again.')
  return viewOf(ctx, inventory.id, id)
}

export async function updateIntakeHeader(
  ctx: ToolContext,
  args: { intake: string; shop?: string; orderNumber?: string; purchasedOn?: string; note?: string },
) {
  const storage = requireStorage(ctx)
  const { inventory, intake } = await locateIntake(ctx, args.intake)
  const header: IntakeHeader = {
    shop: args.shop === undefined ? intake.header.shop : field(args.shop),
    orderNumber: args.orderNumber === undefined ? intake.header.orderNumber : field(args.orderNumber),
    purchasedOn: args.purchasedOn === undefined ? intake.header.purchasedOn : checkDate(args.purchasedOn),
    note: args.note === undefined ? intake.header.note : field(args.note),
  }
  await storage.updateIntakeHeader(intake.id, header, ctx.actor())
  return viewOf(ctx, inventory.id, intake.id)
}

// ---- resolving what was typed -------------------------------------------------------------------------------------

/** Folder by id or path ("Passives/Resistors", no case); empty is the root. */
function resolveFolder(s: InventorySnapshot, text: string | undefined): Id | null {
  const wanted = text?.trim() ?? ''
  if (wanted === '') return null
  const byId = s.folders.find((f) => f.id === wanted && folderPath(s, f.id) !== '')
  if (byId) return byId.id
  const key = wanted.replace(/\s*\/\s*/g, '/').toLowerCase()
  const hits = s.folders.filter((f) => folderPath(s, f.id).toLowerCase() === key)
  if (hits.length === 1) return hits[0]!.id
  throw new ToolError(`No folder "${wanted}". Use an id or a path from get_overview.`)
}

/** Unit by key, symbol or name; 'pcs' by default. */
function resolveUnitKey(s: InventorySnapshot, text: string | undefined): string {
  const wanted = text?.trim() ?? ''
  if (wanted === '') return 'pcs'
  const choices = unitChoices(s)
  const hit =
    choices.find((u) => u.key === wanted) ?? choices.find((u) => u.symbol === wanted) ?? choices.find((u) => same(u.key, wanted) || same(u.symbol, wanted) || same(u.name, wanted))
  if (!hit) throw new ToolError(`No unit "${wanted}". Units: ${choices.map((u) => u.symbol).join(', ')}.`)
  return hit.key
}

function resolveAttribute(s: InventorySnapshot, text: string): Attribute {
  const wanted = text.trim()
  const hit = s.attributes.find((a) => a.id === wanted) ?? s.attributes.find((a) => same(a.name, wanted))
  if (!hit) throw new ToolError(`No attribute "${wanted}". Attributes: ${s.attributes.map((a) => a.name).join(', ') || 'none'}.`)
  return hit
}

function resolveAttributes(s: InventorySnapshot, list: NonNullable<NewItemArgs['attributes']>): DraftNewItem['attributes'] {
  const seen = new Set<Id>()
  const shared: DraftNewItem['attributes'] = []
  const axes: DraftNewItem['attributes'] = []
  for (const x of list) {
    const a = resolveAttribute(s, x.attribute)
    if (seen.has(a.id)) throw new ToolError(`Attribute "${a.name}" is listed twice.`)
    seen.add(a.id)
    if (x.axis) axes.push({ attributeId: a.id, value: null, axis: true })
    else shared.push({ attributeId: a.id, value: field(x.value), axis: false })
  }
  return [...shared, ...axes]
}

/** Tag ids for names or ids: an existing tag, a new tag of the draft, or a new tag made here (added to `tags`). */
function resolveTags(s: InventorySnapshot, tags: DraftNewTag[], wanted: string[]): Id[] {
  const ids: Id[] = []
  for (const text of wanted) {
    const name = text.trim()
    if (name === '') continue
    let id = s.tags.find((t) => t.id === name)?.id ?? s.tags.find((t) => same(t.name, name))?.id ?? tags.find((t) => t.id === name || same(t.name, name))?.id
    if (!id) {
      id = newId()
      tags.push({ id, name })
    }
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

const describe = (key: string, params?: Record<string, string>) => messageFor(key, params)

/** The axes (attribute ids) of an item, existing or new. */
function axesOf(s: InventorySnapshot, newItem: DraftNewItem | null, itemId: Id): Attribute[] {
  if (!newItem) return itemAxes(s, itemId)
  return newItem.attributes.flatMap((x) => (x.axis ? s.attributes.filter((a) => a.id === x.attributeId) : []))
}

/** Typed `values` (attribute id or name -> text) as axis values; a key that is not an axis of the item is refused. */
function resolveValues(s: InventorySnapshot, axes: Attribute[], values: Record<string, string> | undefined): { attributeId: Id; value: string }[] {
  const out: { attributeId: Id; value: string }[] = []
  for (const [key, value] of Object.entries(values ?? {})) {
    const a = axes.find((x) => x.id === key.trim() || same(x.name, key))
    if (!a) {
      const known = s.attributes.some((x) => x.id === key.trim() || same(x.name, key))
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

// ---- add ----------------------------------------------------------------------------------------------------------

export async function addIntakeLines(ctx: ToolContext, args: { intake: string; newItems?: NewItemArgs[]; lines: LineArgs[] }) {
  if (!args.lines || args.lines.length === 0) throw new ToolError('Pass at least one line.')
  // Uploads come first and the ids are fixed here: editDraft may run its callback twice, and neither may upload again.
  const lineIds = args.lines.map(() => newId())
  const photos: (DraftLinePhoto | null)[] = []
  for (const [i, l] of args.lines.entries()) {
    const path = l.photo?.trim()
    if (!path) {
      photos.push(null)
      continue
    }
    try {
      const photo = await attachPhoto(ctx, path)
      photos.push({ ...photo, replace: l.replacePhoto ?? false })
    } catch (e) {
      if (e instanceof ToolError) throw new ToolError(`line ${i + 1}: ${e.message}`)
      throw e
    }
  }
  const view = await editDraft(ctx, args.intake, (draft, header, s) => {
    const errors: string[] = []
    const tags: DraftNewTag[] = [...(draft.newTags ?? [])]
    const fresh = new Map<string, DraftNewItem>()
    ;(args.newItems ?? []).forEach((n, i) => {
      collect(errors, `new item ${i + 1}`, () => {
        const ref = n.ref?.trim()
        if (!ref) throw new ToolError('"ref" is required: the name lines use to point at this new item.')
        if (fresh.has(ref)) throw new ToolError(`ref "${ref}" is used twice.`)
        fresh.set(ref, {
          id: newId(),
          name: n.name ?? '',
          folderId: resolveFolder(s, n.folder),
          unitKey: resolveUnitKey(s, n.unit),
          attributes: resolveAttributes(s, n.attributes ?? []),
          tagIds: resolveTags(s, tags, n.tags ?? []),
        })
      })
    })

    let next = draft
    args.lines.forEach((l, i) => {
      collect(errors, `line ${i + 1}`, () => {
        const ref = l.item?.trim() ?? ''
        const made = fresh.get(ref)
        const inDraft = made ? undefined : draft.newItems.find((n) => n.id === ref)
        const newItem = made ?? inDraft ?? null
        const existing = newItem ? undefined : s.items.find((x) => x.id === ref)
        if (!newItem) {
          if (!existing) throw new ToolError(`No item "${ref}": use an item id from search, the id of a new item of this intake, or the ref of a new item of this call.`)
          if (itemArchived(s, existing)) throw new ToolError(`"${existing.name}" is archived.`)
        }
        const itemId = newItem?.id ?? existing!.id
        const axisValues = resolveValues(s, axesOf(s, newItem, itemId), l.values)
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
            newTags: tags,
          },
          s,
          next,
        )
        if ('errorKey' in built) throw new ToolError(describe(built.errorKey, built.params))
        next = withLine(next, built.line, built.newItem, built.newTags)
      })
    })
    if (errors.length > 0) throw problems(errors)
    // A new item that no line points at was not asked for.
    const unused = [...fresh.entries()].filter(([, n]) => !next.newItems.some((m) => m.id === n.id)).map(([ref]) => `new item "${ref}": no line uses it.`)
    if (unused.length > 0) throw problems(unused)
    return { draft: next, header }
  })
  // Only a saved line makes its picture "used".
  args.lines.forEach((l, i) => {
    if (photos[i]) markPhotoUsed(ctx, l.photo!.trim(), args.intake.trim(), lineIds[i]!)
  })
  return view
}

// ---- edit and remove ----------------------------------------------------------------------------------------------

function findLine(draft: IntakeDraftContent, id: string): DraftLine {
  const line = draft.lines.find((l) => l.id === id.trim())
  if (!line) throw new ToolError(`No line "${id}" in this intake. Line ids are in get_intake.`)
  return line
}

export async function updateIntakeLine(
  ctx: ToolContext,
  args: { intake: string; line: string; values?: Record<string, string>; amount?: string; price?: string; url?: string; photo?: string; replacePhoto?: boolean },
) {
  const path = args.photo?.trim()
  const uploaded = path ? { ...(await attachPhoto(ctx, path)), replace: args.replacePhoto ?? false } : null
  const view = await editDraft(ctx, args.intake, (draft, header, s) => {
    const old = findLine(draft, args.line)
    const newItem = draft.newItems.find((n) => n.id === old.itemId) ?? null
    const axes = axesOf(s, newItem, old.itemId)
    const typed = resolveValues(s, axes, args.values)
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
        photo: uploaded ?? (args.photo !== undefined ? null : old.photo ? { ...old.photo, replace: args.replacePhoto ?? old.photo.replace } : null),
        newTags: draft.newTags ?? [],
      },
      s,
      draft,
    )
    if ('errorKey' in built) throw new ToolError(`line: ${describe(built.errorKey, built.params)}`)
    const line: DraftLine = {
      ...built.line,
      quantity: args.amount === undefined ? old.quantity : built.line.quantity,
      totalPrice: args.price === undefined ? old.totalPrice : built.line.totalPrice,
      sourceUrl: args.url === undefined ? old.sourceUrl : built.line.sourceUrl,
    }
    return { draft: withLine(draft, line, built.newItem, built.newTags), header }
  })
  if (path && uploaded) markPhotoUsed(ctx, path, args.intake.trim(), args.line.trim())
  return view
}

export async function removeIntakeLine(ctx: ToolContext, args: { intake: string; line: string }) {
  return editDraft(ctx, args.intake, (draft, header) => {
    const line = findLine(draft, args.line)
    // Removing the last line of a new item takes the item, and its new tags, with it.
    return { draft: pruneNewItems({ ...draft, lines: draft.lines.filter((l) => l.id !== line.id) }), header }
  })
}

export async function updateNewItem(
  ctx: ToolContext,
  args: { intake: string; item: string; name?: string; folder?: string; unit?: string; attributes?: NonNullable<NewItemArgs['attributes']>; tags?: string[] },
) {
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const id = args.item.trim()
    const old = draft.newItems.find((n) => n.id === id)
    if (!old) throw new ToolError(`No new item "${args.item}" in this intake. New item ids are in get_intake; an item that is already in stock is not changed here.`)
    const tags: DraftNewTag[] = [...(draft.newTags ?? [])]
    const item: DraftNewItem = {
      ...old,
      name: args.name === undefined ? old.name : args.name,
      folderId: args.folder === undefined ? old.folderId : resolveFolder(s, args.folder),
      unitKey: args.unit === undefined ? old.unitKey : resolveUnitKey(s, args.unit),
      attributes: args.attributes === undefined ? old.attributes : resolveAttributes(s, args.attributes),
      tagIds: args.tags === undefined ? old.tagIds : resolveTags(s, tags, args.tags),
    }
    const axisIds = new Set(item.attributes.filter((x) => x.axis).map((x) => x.attributeId))
    // Every line of the item is checked again against the changed item (a new variant attribute needs a value on each).
    const errors: string[] = []
    let lines = draft.lines
    draft.lines.forEach((old, i) => {
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
          newTags: tags,
        },
        s,
        draft,
      )
      if ('errorKey' in built) errors.push(`line ${i + 1}: ${describe(built.errorKey, built.params)}`)
      else lines = lines.map((l) => (l.id === old.id ? { ...old, axisValues: built.line.axisValues } : l))
    })
    if (errors.length > 0) throw problems(errors)
    const nextItem = draft.newItems.map((n) => (n.id === id ? { ...item, name: item.name.trim() } : n))
    return { draft: pruneNewItems({ ...(tags.length > 0 || draft.newTags ? { newTags: tags } : {}), newItems: nextItem, lines }), header }
  })
}
