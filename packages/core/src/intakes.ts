import type { Command, PhotoFile } from './commands'
import type { Id } from './ids'
import { isSourceUrl, MAX_NAME_LENGTH } from './limits'
import type { Attribute, InventorySnapshot, Item, ItemAttribute, Tag, Variant, VariantAttributeValue } from './model'
import { parseNumberValue } from './numbers'
import type { Quantity } from './quantity'
import { folderArchived, itemArchived } from './tree'
import { resolveUnit } from './units'
import { duplicateOf, itemAxes, variantLabel } from './variants'

/** An intake: one batch of stock receipts (an order, a stocktake), a draft until it is committed. Spec 2026-11-13
 *  intakes §3. */

export type IntakeStatus = 'draft' | 'committed'
export interface IntakeHeader {
  shop: string | null
  orderNumber: string | null
  /** YYYY-MM-DD. */
  purchasedOn: string
  note: string | null
}
/** A tag the draft declares by name; the commit creates it. New items reference it by `id` in `tagIds`. It lives while a
 *  new item references it. */
export interface DraftNewTag {
  id: Id
  name: string
}
/** An item a line of the draft creates; lines reference it by `id`. It lives while a line references it. */
export interface DraftNewItem {
  id: Id
  name: string
  folderId: Id | null
  unitKey: string
  /** Axes in axis order; an axis has value null. */
  attributes: { attributeId: Id; value: string | null; axis: boolean }[]
  /** Existing tags and/or DraftNewTag.id of this draft; absent in drafts saved before tags existed. */
  tagIds?: Id[]
}
/** The stored file (renditions, size and delete handle as the upload gave them; absent in drafts saved before they
 *  existed) and whether it replaces the variant's photo. */
export interface DraftLinePhoto extends PhotoFile {
  /** Replace the photo the variant already has; without it such a variant keeps its photo. */
  replace: boolean
}
export interface DraftLine {
  id: Id
  /** An existing item or a DraftNewItem.id. */
  itemId: Id
  /** Canonical values; [] for an item without axes. */
  axisValues: { attributeId: Id; value: string }[]
  quantity: Quantity
  /** Minor units. */
  totalPrice: number | null
  sourceUrl: string | null
  photo: DraftLinePhoto | null
  /** Minted when the line is created and reused on every commit attempt, so a retried commit makes nothing twice. */
  ids: { movementId: Id; variantId: Id; photoId: Id }
}
export interface IntakeDraftContent {
  /** Absent in drafts saved before tags existed. */
  newTags?: DraftNewTag[]
  newItems: DraftNewItem[]
  lines: DraftLine[]
}
export type CommittedLineKind = 'add' | 'newValue' | 'newItem'
export interface CommittedLine {
  lineId: Id
  kind: CommittedLineKind
  itemId: Id
  variantId: Id | null
  movementId: Id
  /** Names at commit time, shown when the item is gone (spec §8). */
  itemName: string
  variantLabel: string | null
  quantity: Quantity
  unitKey: string
  totalPrice: number | null
  sourceUrl: string | null
}
export interface Intake {
  id: Id
  inventoryId: Id
  status: IntakeStatus
  header: IntakeHeader
  /** Null once committed. */
  draft: IntakeDraftContent | null
  /** Null while a draft. */
  lines: CommittedLine[] | null
  /** Changes on every write of this row. */
  draftRev: string
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
  committedAt: string | null
}

export type LineResolution =
  /** An existing bucket; an archived variant comes back from the archive. */
  | { kind: 'add'; itemId: Id; variantId: Id | null; unarchive: boolean }
  /** A new variant of an existing item; `sharedWith`: the earlier line that creates the same variant. */
  | { kind: 'newValue'; itemId: Id; variantId: Id; sharedWith: Id | null }
  /** An item of draft.newItems; its variant (when it has axes) as for newValue. */
  | { kind: 'newItem'; itemId: Id; variantId: Id | null }
  | { kind: 'problem'; code: 'item_archived' | 'missing_axis_value' | 'invalid_value' | 'unknown_item' | 'invalid_link' }
export interface ResolvedIntake {
  lines: { lineId: Id; resolution: LineResolution }[]
  ok: boolean
}

type IntakeCommit = Extract<Command, { type: 'intake.commit' }>
type Problem = Extract<LineResolution, { kind: 'problem' }>['code']

export function emptyIntakeDraft(): IntakeDraftContent {
  return { newItems: [], lines: [] }
}

/** Drops the new items no line references, and the new tags no remaining new item references. */
export function pruneNewItems(draft: IntakeDraftContent): IntakeDraftContent {
  const used = new Set(draft.lines.map((l) => l.itemId))
  const newItems = draft.newItems.filter((n) => used.has(n.id))
  const tagged = new Set(newItems.flatMap((n) => n.tagIds ?? []))
  return { ...draft, newItems, ...(draft.newTags ? { newTags: draft.newTags.filter((t) => tagged.has(t.id)) } : {}) }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Where each tag id a new item may name ends up: an existing tag id stays; a new tag of the draft goes to the existing
 *  tag with the same name (trim, no case) or to the first new tag with that name. Ids of no tag are absent. */
function tagTargets(draft: IntakeDraftContent, s: InventorySnapshot): Map<Id, Id> {
  const targets = new Map<Id, Id>(s.tags.map((t) => [t.id, t.id] as const))
  const firstNew: { id: Id; name: string }[] = []
  for (const t of draft.newTags ?? []) {
    const known = s.tags.find((x) => sameName(x.name, t.name)) ?? firstNew.find((x) => sameName(x.name, t.name))
    if (known) targets.set(t.id, known.id)
    else {
      firstNew.push(t)
      targets.set(t.id, t.id)
    }
  }
  return targets
}

/** A typed value as the attribute stores it: a canonical number ("4k7" -> "4700"), a list option as the list spells it
 *  (case does not matter), or trimmed text. Null when empty or when it does not fit. */
function canonicalValue(a: Attribute, text: string): string | null {
  const t = text.trim()
  if (t === '') return null
  if (a.kind === 'number') return parseNumberValue(t, a)
  if (a.kind === 'enum') {
    const key = t.toLowerCase()
    return a.options.find((o) => o.toLowerCase() === key) ?? null
  }
  return t
}

/** The line's canonical value on each axis; or why a value is missing or does not fit. Values on attributes that are
 *  not axes are ignored. */
function lineValues(line: DraftLine, axes: readonly Attribute[]): Map<Id, string> | Problem {
  const values = new Map<Id, string>()
  for (const a of axes) {
    const typed = line.axisValues.find((x) => x.attributeId === a.id)?.value
    if (typed === undefined || typed.trim() === '') return 'missing_axis_value'
    const value = canonicalValue(a, typed)
    if (value === null) return 'invalid_value'
    values.set(a.id, value)
  }
  return values
}

/** The axes of a new item of the draft, in order; or what keeps it from being created: its folder archived (or gone,
 *  which needs an archive first), an empty or too long name, a unit gone, a tag that is neither in the copy nor a new tag
 *  of the draft (or a new tag with a bad name), an attribute gone, a shared value that does not fit. */
function newItemAxes(n: DraftNewItem, s: InventorySnapshot, tags: ReadonlyMap<Id, Id>, badTags: ReadonlySet<Id>): Attribute[] | Problem {
  if (n.folderId !== null && (!s.folders.some((f) => f.id === n.folderId) || folderArchived(s, n.folderId))) {
    return 'item_archived'
  }
  const name = n.name.trim()
  if (name === '' || name.length > MAX_NAME_LENGTH || !resolveUnit(n.unitKey, s.units)) return 'invalid_value'
  if ((n.tagIds ?? []).some((id) => !tags.has(id) || badTags.has(id))) return 'invalid_value'
  const axes: Attribute[] = []
  for (const x of n.attributes) {
    const a = s.attributes.find((y) => y.id === x.attributeId)
    if (!a) return 'invalid_value'
    if (x.axis) axes.push(a)
    else if (x.value !== null && x.value.trim() !== '' && canonicalValue(a, x.value) === null) return 'invalid_value'
  }
  return axes
}

/** One new variant per item and set of values, however many lines ask for it (spec §7 compares values as §4.7 of the
 *  variants spec: text without case). */
function variantKey(itemId: Id, axes: readonly Attribute[], values: ReadonlyMap<Id, string>): string {
  return JSON.stringify([itemId, ...axes.map((a) => (a.kind === 'text' ? values.get(a.id)!.toLowerCase() : values.get(a.id)!))])
}

/**
 * What each line of the draft does against this copy of the inventory (spec §6–7): adds to a bucket that exists (an
 * archived variant is unarchived), creates a variant of an existing item, or goes to an item the draft creates. The
 * first line asking for a new variant mints it; later lines with the same item and values share it. `ok` is false when
 * any line has a problem: nothing may be committed then.
 */
export function resolveIntake(draft: IntakeDraftContent, s: InventorySnapshot): ResolvedIntake {
  const newItems = new Map(draft.newItems.map((n) => [n.id, n] as const))
  const creators = new Map<string, { lineId: Id; variantId: Id }>()
  const tags = tagTargets(draft, s)
  const badTags = new Set((draft.newTags ?? []).filter((t) => t.name.trim() === '' || t.name.trim().length > MAX_NAME_LENGTH).map((t) => t.id))

  const resolve = (line: DraftLine): LineResolution => {
    const problem = (code: Problem): LineResolution => ({ kind: 'problem', code })
    const draftItem = newItems.get(line.itemId)
    let axes: readonly Attribute[]
    if (draftItem) {
      const found = newItemAxes(draftItem, s, tags, badTags)
      if (typeof found === 'string') return problem(found)
      axes = found
      if (axes.length === 0) return { kind: 'newItem', itemId: line.itemId, variantId: null }
    } else {
      const existing = s.items.find((i) => i.id === line.itemId)
      if (!existing) return problem('unknown_item')
      if (itemArchived(s, existing)) return problem('item_archived')
      axes = itemAxes(s, existing.id)
      if (axes.length === 0) return { kind: 'add', itemId: existing.id, variantId: null, unarchive: false }
    }
    const values = lineValues(line, axes)
    if (typeof values === 'string') return problem(values)
    if (!draftItem) {
      const same = duplicateOf(s, line.itemId, values)
      if (same) return { kind: 'add', itemId: line.itemId, variantId: same.id, unarchive: same.archivedAt !== null }
    }
    const key = variantKey(line.itemId, axes, values)
    const creator = creators.get(key)
    if (!creator) creators.set(key, { lineId: line.id, variantId: line.ids.variantId })
    const variantId = creator?.variantId ?? line.ids.variantId
    return draftItem
      ? { kind: 'newItem', itemId: line.itemId, variantId }
      : { kind: 'newValue', itemId: line.itemId, variantId, sharedWith: creator?.lineId ?? null }
  }

  // A link the commit would refuse marks the line, once its item and values resolve (an item problem is told first).
  const withLink = (line: DraftLine): LineResolution => {
    const resolution = resolve(line)
    if (resolution.kind === 'problem' || line.sourceUrl === null || isSourceUrl(line.sourceUrl)) return resolution
    return { kind: 'problem', code: 'invalid_link' }
  }
  const lines = draft.lines.map((line) => ({ lineId: line.id, resolution: withLink(line) }))
  return { lines, ok: lines.every((l) => l.resolution.kind !== 'problem') }
}

/**
 * The intake.commit command for a draft resolved against `s` (resolveIntake on the same copy). New items no line
 * references are left out. A line's photo goes to the item's gallery when the line has no variant; a variant gets it
 * when the variant is new or has no photo yet, and replaces the variant's photo only when the line asks to; a variant
 * gets at most one photo, from the first line that gives it one. Throws when the draft has problem lines.
 */
export function buildIntakeCommit(intake: Intake, resolved: ResolvedIntake, s: InventorySnapshot, baseRev: string): Command {
  if (!resolved.ok) throw new Error('buildIntakeCommit: the draft has lines with problems')
  if (intake.draft === null) throw new Error('buildIntakeCommit: the intake is committed already')
  const draft = pruneNewItems(intake.draft)
  const resolutions = new Map(resolved.lines.map((l) => [l.lineId, l.resolution] as const))
  const attributes = new Map(s.attributes.map((a) => [a.id, a] as const))
  const draftItems = new Map(draft.newItems.map((n) => [n.id, n] as const))
  const targets = tagTargets(draft, s)
  const created = new Set([...targets.values()].filter((id) => !s.tags.some((t) => t.id === id)))
  const newTags = (draft.newTags ?? []).filter((t) => targets.get(t.id) === t.id && created.has(t.id)).map((t) => ({ id: t.id, name: t.name }))

  const newItems: IntakeCommit['newItems'] = draft.newItems.map((n) => {
    let position = 0
    return {
      id: n.id,
      folderId: n.folderId,
      name: n.name,
      unitKey: n.unitKey,
      tagIds: [...new Set((n.tagIds ?? []).map((id) => targets.get(id)!))],
      attributes: n.attributes.map((x) => {
        const a = attributes.get(x.attributeId)
        const value = x.axis || x.value === null ? null : a ? canonicalValue(a, x.value) : x.value
        return { attributeId: x.attributeId, value, axisPosition: x.axis ? position++ : null }
      }),
    }
  })
  const axesOf = (itemId: Id): Attribute[] => {
    const n = draftItems.get(itemId)
    if (!n) return itemAxes(s, itemId)
    return n.attributes.filter((x) => x.axis).map((x) => attributes.get(x.attributeId)!)
  }

  const made: { line: DraftLine; resolution: Exclude<LineResolution, { kind: 'problem' }> }[] = []
  const newVariants: IntakeCommit['newVariants'] = []
  const unarchive = new Set<Id>()
  const receipts: IntakeCommit['receipts'] = []
  const photos: IntakeCommit['photos'] = []
  const photographed = new Set<Id>()
  for (const line of draft.lines) {
    const resolution = resolutions.get(line.id)
    if (!resolution || resolution.kind === 'problem') throw new Error(`buildIntakeCommit: line ${line.id} is not resolved`)
    made.push({ line, resolution })
    const { itemId, variantId } = resolution
    if (resolution.kind === 'add' && resolution.unarchive && variantId !== null) unarchive.add(variantId)
    if (resolution.kind !== 'add' && variantId !== null && !newVariants.some((v) => v.id === variantId)) {
      const axes = axesOf(itemId)
      const values = lineValues(line, axes)
      if (typeof values === 'string') throw new Error(`buildIntakeCommit: line ${line.id}: ${values}`)
      newVariants.push({ id: variantId, itemId, values: axes.map((a) => ({ attributeId: a.id, value: values.get(a.id)! })) })
    }
    receipts.push({
      movementId: line.ids.movementId,
      itemId,
      variantId,
      quantity: line.quantity,
      totalPrice: line.totalPrice,
      sourceUrl: line.sourceUrl,
    })
    if (line.photo) {
      const { provider, fileId, url, urls = null, width = null, height = null, deleteHandle = null } = line.photo
      const file = { provider, fileId, url, urls, width, height, deleteHandle }
      const add = (replaces: Id | undefined) => photos.push({ id: line.ids.photoId, itemId, variantId, replaces, ...file })
      if (variantId === null) add(undefined)
      else if (!photographed.has(variantId)) {
        const current = s.photos.find((p) => p.variantId === variantId)
        if (!current || line.photo.replace) {
          add(current?.id)
          photographed.add(variantId)
        }
      }
    }
  }

  const command: IntakeCommit = {
    type: 'intake.commit',
    intakeId: intake.id,
    inventoryId: intake.inventoryId,
    baseRev,
    baseDraftRev: intake.draftRev,
    header: intake.header,
    newTags,
    newItems,
    newVariants,
    unarchiveVariants: [...unarchive],
    receipts,
    photos,
    lines: [],
  }
  const after = snapshotAfterIntake(s, command)
  command.lines = made.map(({ line, resolution }) => {
    const item = after.items.find((i) => i.id === resolution.itemId)!
    const variant = resolution.variantId === null ? undefined : after.variants.find((v) => v.id === resolution.variantId)
    return {
      lineId: line.id,
      kind: resolution.kind,
      itemId: resolution.itemId,
      variantId: resolution.variantId,
      movementId: line.ids.movementId,
      itemName: item.name,
      variantLabel: variant ? variantLabel(after, variant) : null,
      quantity: line.quantity,
      unitKey: item.unitKey,
      totalPrice: line.totalPrice,
      sourceUrl: line.sourceUrl,
    }
  })
  return command
}

const NO_AUDIT = { createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }

/**
 * The copy's tags, items and variants as the commit leaves them: its new tags, its new items with their tags and attributes, its new variants with
 * their values, its unarchived variants active. Rows the copy holds already (a retried commit) are not added again.
 * Photos and stock stay as they are. New rows carry empty audit fields.
 */
export function snapshotAfterIntake(s: InventorySnapshot, c: IntakeCommit): InventorySnapshot {
  const knownTags = new Set(s.tags.map((t) => t.id))
  const knownItems = new Set(s.items.map((i) => i.id))
  const knownVariants = new Set(s.variants.map((v) => v.id))
  const tags = c.newTags.filter((t) => !knownTags.has(t.id))
  const items = c.newItems.filter((n) => !knownItems.has(n.id))
  const variants = c.newVariants.filter((v) => !knownVariants.has(v.id))
  const unarchive = new Set(c.unarchiveVariants)
  return {
    ...s,
    tags: [...s.tags, ...tags.map((t): Tag => ({ id: t.id, inventoryId: c.inventoryId, name: t.name, color: null, ...NO_AUDIT }))],
    items: [
      ...s.items,
      ...items.map(
        (n): Item => ({
          id: n.id,
          inventoryId: c.inventoryId,
          folderId: n.folderId,
          name: n.name,
          description: null,
          icon: null,
          color: null,
          unitKey: n.unitKey,
          tagIds: n.tagIds,
          ...NO_AUDIT,
          archivedAt: null,
          archiveId: null,
        }),
      ),
    ],
    itemAttributes: [
      ...s.itemAttributes,
      ...items.flatMap((n) =>
        n.attributes.map(
          (x): ItemAttribute => ({
            itemId: n.id,
            attributeId: x.attributeId,
            value: x.axisPosition === null ? x.value : null,
            axisPosition: x.axisPosition,
          }),
        ),
      ),
    ],
    variants: [
      ...s.variants.map((v) => (unarchive.has(v.id) ? { ...v, archivedAt: null, archiveId: null } : v)),
      ...variants.map(
        (v): Variant => ({ id: v.id, itemId: v.itemId, description: null, position: 0, ...NO_AUDIT, archivedAt: null, archiveId: null }),
      ),
    ],
    variantAttributeValues: [
      ...s.variantAttributeValues,
      ...variants.flatMap((v) => v.values.map((x): VariantAttributeValue => ({ variantId: v.id, attributeId: x.attributeId, value: x.value }))),
    ],
  }
}
