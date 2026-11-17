import {
  emptyIntakeDraft,
  folderArchived,
  itemArchived,
  itemAxes,
  newId,
  pruneNewItems,
  resolveIntake,
  sameName as same,
  type Attribute,
  type AttributeKind,
  type DraftLine,
  type DraftLinePhoto,
  type DraftNewAttribute,
  type DraftNewFolder,
  type DraftNewItem,
  type DraftNewTag,
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
  unitChoices,
  withLine,
  withNewAttribute,
  withNewFolder,
  withNewItem,
  withoutNewAttribute,
  withoutNewFolder,
  withoutNewItem,
  type DraftError,
} from '@antresol/kit'
import { requireStorage, requireSource, resolveInventory, type ToolContext } from '../context'
import { assertDraft, editDraft, locateIntake, viewAfterSave } from '../draft-edit'
import { ToolError } from '../errors'
import { messageFor } from '../messages'
import { draftAttributes, draftFolderPath, entityProblemText, folderPath, problemText } from '../shape'
import { attachPhoto, markPhotosUsed } from './photos'

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
  description?: string
  /** A picture path from list_photos: the item's own photo. */
  photo?: string
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
  const existing = s.folders.filter((f) => !folderArchived(s, f.id)).map((f) => ({ id: f.id, path: folderPath(s, f.id) })).filter((f) => f.path !== '')
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

function resolveAttribute(attrs: Attribute[], text: string): Attribute {
  const wanted = text.trim()
  const hit = attrs.find((a) => a.id === wanted) ?? attrs.find((a) => same(a.name, wanted))
  if (!hit) throw new ToolError(`No attribute "${wanted}". Attributes: ${attrs.map((a) => a.name).join(', ') || 'none'}.`)
  return hit
}

function resolveAttributes(attrs: Attribute[], list: NonNullable<NewItemArgs['attributes']>): DraftNewItem['attributes'] {
  const seen = new Set<Id>()
  const shared: DraftNewItem['attributes'] = []
  const axes: DraftNewItem['attributes'] = []
  for (const x of list) {
    const a = resolveAttribute(attrs, x.attribute)
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

/** A kit refusal as text. `alreadyCreated` names the other line by its number and id; a duplicate name names the one that exists. */
function refusal(key: string, params: Record<string, string> | undefined, s: InventorySnapshot, draft: IntakeDraftContent): string {
  const text = describe(key, params)
  if (key === 'intakes.line.alreadyCreated' && params?.line) {
    const n = draft.lines.findIndex((l) => l.id === params.line)
    return `${text} That is ${n >= 0 ? `line ${n + 1} (id ${params.line})` : `line ${params.line}`}.`
  }
  if (key === 'intakes.folder.duplicate' && params?.id) {
    const path = folderChoices(s, draft).find((f) => f.id === params.id)?.path
    return `${text} It is ${path ? `"${path}" ` : ''}(id ${params.id}); use it, or pick another name.`
  }
  if (key === 'intakes.attribute.duplicate' && params?.id) {
    const name = draftAttributes(s, draft).find((a) => a.id === params.id)?.name
    return `${text} It is ${name ? `"${name}" ` : ''}(id ${params.id}); use it, or pick another name.`
  }
  return text
}
const failed = (r: IntakeDraftContent | DraftError, s: InventorySnapshot, draft: IntakeDraftContent): IntakeDraftContent => {
  if ('errorKey' in r) throw new ToolError(refusal(r.errorKey, r.params, s, draft))
  return r
}

/**
 * Refuses a change that leaves a line or an entity (folder, attribute, new item) with a problem it did not have before:
 * the checks that only run inside buildDraftLine do not cover an item without lines, an item whose lines stay, or an
 * attribute that lines already use. A problem that was already there is not this call's and does not block it.
 */
function refuseNewProblems(before: IntakeDraftContent, after: IntakeDraftContent, s: InventorySnapshot): void {
  const was = resolveIntake(before, s)
  const now = resolveIntake(after, s)
  const attrs = draftAttributes(s, after)
  const nameOf = (id: Id): string => {
    const folder = folderChoices(s, after).find((f) => f.id === id)
    return folder ? `"${folder.path}"` : `"${attrs.find((a) => a.id === id)?.name ?? id}"`
  }
  const list: string[] = []
  now.lines.forEach((l, i) => {
    if (l.resolution.kind !== 'problem') return
    const had = was.lines.find((x) => x.lineId === l.lineId)
    if (had && had.resolution.kind === 'problem') return
    list.push(`line ${i + 1}: ${problemText(l.resolution.code)}.`)
  })
  for (const e of now.entities) {
    if (e.problem === null || was.entities.some((x) => x.kind === e.kind && x.id === e.id && x.problem !== null)) continue
    const label =
      e.kind === 'item'
        ? `new item "${after.newItems.find((n) => n.id === e.id)?.name ?? e.id}"`
        : e.kind === 'folder'
          ? `new folder ${nameOf(e.id)}`
          : `new attribute ${nameOf(e.id)}`
    list.push(`${label}: ${entityProblemText(e.problem, e.kind, nameOf) ?? 'has a problem'}.`)
  }
  if (list.length > 0) throw problems(list)
}

/** A picture that stands in for the upload while an edit is only being checked. */
const STAND_IN_FILE: PhotoFile = { provider: 'dry', fileId: 'dry', url: 'dry', urls: null, deleteHandle: null, width: 1, height: 1 }
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
  const itemPhotoIds = newItems.map(() => newId())
  const build = (photos: (DraftLinePhoto | null)[], itemPhotos: (PhotoFile | null)[]) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const errors: string[] = []
    const attrs = draftAttributes(s, draft)
    const tags: DraftNewTag[] = [...(draft.newTags ?? [])]
    const fresh = new Map<string, { item: DraftNewItem; withoutLines: boolean; index: number }>()
    newItems.forEach((n, i) => {
      collect(errors, `new item ${i + 1}`, () => {
        const ref = n.ref?.trim()
        if (!ref) throw new ToolError('"ref" is required: the name lines use to point at this new item.')
        if (fresh.has(ref)) throw new ToolError(`ref "${ref}" is used twice.`)
        const photo = itemPhotos[i] ?? null
        fresh.set(ref, {
          index: i,
          withoutLines: n.withoutLines === true,
          item: {
            id: itemIds[i]!,
            name: n.name ?? '',
            folderId: resolveFolder(s, draft, n.folder),
            unitKey: resolveUnitKey(s, n.unit),
            attributes: resolveAttributes(attrs, n.attributes ?? []),
            tagIds: resolveTags(s, tags, n.tags ?? []),
            description: field(n.description),
            ...(photo ? { photo, photoId: itemPhotoIds[i]! } : {}),
          },
        })
      })
    })

    let next = draft
    const used = new Set<string>()
    lines.forEach((l, i) => {
      collect(errors, `line ${i + 1}`, () => {
        const ref = l.item?.trim() ?? ''
        const made = fresh.get(ref)?.item
        if (made) used.add(ref)
        const inDraft = made ? undefined : draft.newItems.find((n) => n.id === ref)
        const newItem = made ?? inDraft ?? null
        const existing = newItem ? undefined : s.items.find((x) => x.id === ref)
        if (!newItem) {
          if (!existing) throw new ToolError(`No item "${ref}": use an item id from search, the id of a new item of this intake, or the ref of a new item of this call.`)
          if (itemArchived(s, existing)) throw new ToolError(`"${existing.name}" is archived.`)
        }
        const itemId = newItem?.id ?? existing!.id
        const axes = axesOf(s, attrs, newItem, itemId)
        if (newItem?.photo && photos[i] && axes.length === 0) {
          throw new ToolError(
            made
              ? 'give the photo once: this new item has its own photo and the line has one too (the line\'s photo would be lost). Use the item\'s photo.'
              : 'the item already has a photo and the line passes another (it would replace the item\'s photo): change the item\'s photo with update_new_item.',
          )
        }
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
            newTags: tags,
          },
          s,
          next,
        )
        if ('errorKey' in built) throw new ToolError(refusal(built.errorKey, built.params, s, next))
        next = withLine(next, built.line, built.newItem, built.newTags)
      })
    })
    if (errors.length > 0) throw problems(errors)
    // A new item lives on its own; one that no line uses and that was not asked for without lines is a slip.
    const unused: string[] = []
    for (const [ref, f] of fresh) {
      if (!used.has(ref) && !f.withoutLines) unused.push(`new item "${ref}": no line uses it (pass withoutLines: true to make it with no stock).`)
      else if (!next.newItems.some((n) => n.id === f.item.id)) next = withNewItem(next, f.item)
    }
    if (unused.length > 0) throw problems(unused)
    // New tags this call made go with the draft whenever a new item names them, with a line or without.
    if (tags.length > (draft.newTags ?? []).length) next = pruneNewItems({ ...next, newTags: tags })
    refuseNewProblems(draft, next, s)
    return { draft: next, header }
  }
  // Refusals that need no I/O come before any upload: the same checks, run on stand-in photos against what the database holds now.
  if (lines.some((l) => l.photo?.trim()) || newItems.some((n) => n.photo?.trim())) {
    await dryRun(ctx, args.intake, build(
      lines.map((l) => (l.photo?.trim() ? STAND_IN : null)),
      newItems.map((n) => (n.photo?.trim() ? STAND_IN_FILE : null)),
    ))
  }
  const photos: (DraftLinePhoto | null)[] = []
  const itemPhotos: (PhotoFile | null)[] = []
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
  for (const [i, n] of newItems.entries()) {
    const p = await upload(`new item ${i + 1}`, n.photo)
    itemPhotos.push(p ? fileOnly(p) : null)
  }
  for (const [i, l] of lines.entries()) {
    const p = await upload(`line ${i + 1}`, l.photo)
    photos.push(p)
  }
  const view = await editDraft(ctx, args.intake, build(photos, itemPhotos))
  // Only a saved line or item makes its picture "used".
  const warning = markPhotosUsed(ctx, [
    ...lines.flatMap((l, i) => (photos[i] ? [{ file: l.photo!.trim(), intakeId: args.intake.trim(), lineId: lineIds[i]! }] : [])),
    ...newItems.flatMap((n, i) => (itemPhotos[i] ? [{ file: n.photo!.trim(), intakeId: args.intake.trim(), lineId: itemPhotoIds[i]! }] : [])),
  ])
  return warning ? { ...view, warning } : view
}

// ---- edit and remove ----------------------------------------------------------------------------------------------

function findLine(draft: IntakeDraftContent, id: string): DraftLine {
  const line = draft.lines.find((l) => l.id === id.trim())
  if (!line) throw new ToolError(`No line "${id}" in this intake. Line ids are in get_intake.`)
  return line
}

export async function updateIntakeLine(
  ctx: ToolContext,
  args: { intake: string; line: string; values?: Record<string, string>; amount?: string; price?: string; url?: string; photo?: string },
) {
  const path = args.photo?.trim()
  const build = (uploaded: DraftLinePhoto | null) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const old = findLine(draft, args.line)
    const newItem = draft.newItems.find((n) => n.id === old.itemId) ?? null
    const attrs = draftAttributes(s, draft)
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
        newTags: draft.newTags ?? [],
      },
      s,
      draft,
    )
    if ('errorKey' in built) throw new ToolError(`line: ${refusal(built.errorKey, built.params, s, draft)}`)
    const line: DraftLine = {
      ...built.line,
      quantity: args.amount === undefined ? old.quantity : built.line.quantity,
      totalPrice: args.price === undefined ? old.totalPrice : built.line.totalPrice,
      sourceUrl: args.url === undefined ? old.sourceUrl : built.line.sourceUrl,
    }
    return { draft: withLine(draft, line, built.newItem, built.newTags), header }
  }
  // Refusals that need no I/O come before the upload: the same edit, run with a stand-in photo on what the database holds now.
  if (path) await dryRun(ctx, args.intake, build(STAND_IN))
  const uploaded = path ? await attachPhoto(ctx, path) : null
  const view = await editDraft(ctx, args.intake, build(uploaded))
  const warning = path && uploaded ? markPhotosUsed(ctx, [{ file: path, intakeId: args.intake.trim(), lineId: args.line.trim() }]) : null
  return warning ? { ...view, warning } : view
}

export async function removeIntakeLine(ctx: ToolContext, args: { intake: string; line: string }) {
  return editDraft(ctx, args.intake, (draft, header) => {
    const line = findLine(draft, args.line)
    // The new item stays (it lives on its own); only a new tag that nothing uses any more goes.
    return { draft: pruneNewItems({ ...draft, lines: draft.lines.filter((l) => l.id !== line.id) }), header }
  })
}

function findNewItem(draft: IntakeDraftContent, text: string): DraftNewItem {
  const old = draft.newItems.find((n) => n.id === text.trim())
  if (!old) throw new ToolError(`No new item "${text}" in this intake. New item ids are in get_intake; an item that is already in stock is not changed here.`)
  return old
}

export async function updateNewItem(
  ctx: ToolContext,
  args: {
    intake: string
    item: string
    name?: string
    description?: string
    folder?: string
    unit?: string
    attributes?: NonNullable<NewItemArgs['attributes']>
    tags?: string[]
    /** A picture path from list_photos; an empty text removes the item's photo. */
    photo?: string
  },
) {
  const path = args.photo?.trim()
  const photoId = newId()
  const build = (photo: PhotoFile | null) => (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => {
    const id = args.item.trim()
    const old = findNewItem(draft, id)
    const attrs = draftAttributes(s, draft)
    const tags: DraftNewTag[] = [...(draft.newTags ?? [])]
    const { photo: oldPhoto, photoId: oldPhotoId, ...rest } = old
    const item: DraftNewItem = {
      ...rest,
      name: args.name === undefined ? old.name : args.name,
      description: args.description === undefined ? old.description : field(args.description),
      folderId: args.folder === undefined ? old.folderId : resolveFolder(s, draft, args.folder),
      unitKey: args.unit === undefined ? old.unitKey : resolveUnitKey(s, args.unit),
      attributes: args.attributes === undefined ? old.attributes : resolveAttributes(attrs, args.attributes),
      tagIds: args.tags === undefined ? old.tagIds : resolveTags(s, tags, args.tags),
      ...(photo ? { photo, photoId } : args.photo === undefined && oldPhoto ? { photo: oldPhoto, ...(oldPhotoId ? { photoId: oldPhotoId } : {}) } : {}),
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
      if ('errorKey' in built) errors.push(`line ${i + 1}: ${refusal(built.errorKey, built.params, s, draft)}`)
      else lines = lines.map((l) => (l.id === old.id ? { ...old, axisValues: built.line.axisValues } : l))
    })
    if (errors.length > 0) throw problems(errors)
    const withItem = withNewItem({ ...draft, ...(tags.length > 0 || draft.newTags ? { newTags: tags } : {}), lines }, item)
    const next = pruneNewItems(withItem)
    refuseNewProblems(draft, next, s)
    return { draft: next, header }
  }
  // Refusals that need no I/O come before the upload: the same edit, run with a stand-in photo on what the database holds now.
  if (path) await dryRun(ctx, args.intake, build(STAND_IN_FILE))
  const up = path ? await attachPhoto(ctx, path) : null
  const photo: PhotoFile | null = up ? fileOnly(up) : null
  const view = await editDraft(ctx, args.intake, build(photo))
  const warning = path && photo ? markPhotosUsed(ctx, [{ file: path, intakeId: args.intake.trim(), lineId: photoId }]) : null
  return warning ? { ...view, warning } : view
}

export async function removeNewItem(ctx: ToolContext, args: { intake: string; item: string }) {
  return editDraft(ctx, args.intake, (draft, header) => {
    const old = findNewItem(draft, args.item)
    return { draft: withoutNewItem(draft, old.id).content, header }
  })
}

// ---- draft folders and attributes ---------------------------------------------------------------------------------

function findNewFolder(s: InventorySnapshot, draft: IntakeDraftContent, text: string): DraftNewFolder {
  const wanted = text.trim()
  const key = wanted.replace(/\s*\/\s*/g, '/').toLowerCase()
  const own = draft.newFolders ?? []
  const hit = own.find((f) => f.id === wanted) ?? own.find((f) => draftFolderPath(s, draft, f.id).toLowerCase() === key)
  if (!hit) throw new ToolError(`No new folder "${text}" in this intake: folders already in stock are not changed here. New folders are in get_intake.`)
  return hit
}

export async function createFolder(ctx: ToolContext, args: { intake: string; name: string; parent?: string }) {
  const id = newId()
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const parentId = resolveFolder(s, draft, args.parent)
    return { draft: failed(withNewFolder(draft, s, { id, name: args.name ?? '', parentId }), s, draft), header }
  })
}

export async function updateFolder(ctx: ToolContext, args: { intake: string; folder: string; name?: string; parent?: string }) {
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const old = findNewFolder(s, draft, args.folder)
    const next: DraftNewFolder = {
      ...old,
      name: args.name === undefined ? old.name : args.name,
      parentId: args.parent === undefined ? old.parentId : resolveFolder(s, draft, args.parent),
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

export interface AttributeArgs {
  name: string
  kind: 'number' | 'list' | 'text'
  unit?: string
  siPrefixes?: boolean
  options?: string[]
}
const KIND: Record<AttributeArgs['kind'], AttributeKind> = { number: 'number', list: 'enum', text: 'text' }

function attributeOf(id: Id, a: AttributeArgs): DraftNewAttribute {
  const kind = KIND[a.kind]
  if (!kind) throw new ToolError(`Attribute kind "${String(a.kind)}" is not one of number, list, text.`)
  if (kind === 'enum' && !(a.options ?? []).some((o) => o.trim() !== '')) throw new ToolError('A list attribute needs at least one option: pass options.')
  return {
    id,
    name: a.name ?? '',
    kind,
    unit: kind === 'number' ? (a.unit ?? '').trim() : '',
    siPrefixes: kind === 'number' && a.siPrefixes === true,
    options: kind === 'enum' ? (a.options ?? []).map((o) => o.trim()).filter((o) => o !== '') : [],
  }
}

function findNewAttribute(draft: IntakeDraftContent, text: string): DraftNewAttribute {
  const wanted = text.trim()
  const own = draft.newAttributes ?? []
  const hit = own.find((a) => a.id === wanted) ?? own.find((a) => same(a.name, wanted))
  if (!hit) throw new ToolError(`No new attribute "${text}" in this intake: attributes already in stock are not changed here. New attributes are in get_intake.`)
  return hit
}

export async function createAttribute(ctx: ToolContext, args: AttributeArgs & { intake: string }) {
  const id = newId()
  return editDraft(ctx, args.intake, (draft, header, s) => ({ draft: failed(withNewAttribute(draft, s, attributeOf(id, args)), s, draft), header }))
}

export async function updateAttribute(ctx: ToolContext, args: Partial<AttributeArgs> & { intake: string; attribute: string }) {
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const old = findNewAttribute(draft, args.attribute)
    const merged: AttributeArgs = {
      name: args.name ?? old.name,
      kind: args.kind ?? (old.kind === 'enum' ? 'list' : old.kind),
      unit: args.unit ?? old.unit,
      siPrefixes: args.siPrefixes ?? old.siPrefixes,
      options: args.options ?? old.options,
    }
    const next = failed(withNewAttribute(draft, s, attributeOf(old.id, merged)), s, draft)
    refuseNewProblems(draft, next, s)
    return { draft: next, header }
  })
}

export async function removeAttribute(ctx: ToolContext, args: { intake: string; attribute: string }) {
  return editDraft(ctx, args.intake, (draft, header, s) => {
    const old = findNewAttribute(draft, args.attribute)
    return { draft: failed(withoutNewAttribute(draft, old.id), s, draft), header }
  })
}
