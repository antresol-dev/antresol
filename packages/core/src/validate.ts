import type { Command } from './commands'
import type { Id } from './ids'
import { CURRENCIES } from './money'
import type { Archivable, Attribute, AttributeKind, Folder, InventorySnapshot, Item, ItemAttribute, Variant } from './model'
import { isCanonicalNumber } from './numbers'
import { bucketStock } from './stock'
import { cmpQ, parseQuantity, type Quantity } from './quantity'
import { customUnitKey, resolveUnit, SI_PREFIXES } from './units'
import { isInSubtree } from './tree'
import { axisRemovalPreview, duplicateOf, itemAxes, sameAxisValue } from './variants'

export const DOMAIN_ERROR_CODES = [
  'name_required',
  'name_too_long',
  'duplicate_name',
  'invalid_currency',
  'invalid_quantity',
  'invalid_price',
  'invalid_url',
  'invalid_option',
  'insufficient_stock',
  'folder_cycle',
  'not_found',
  'archived',
  'not_archived',
  'unit_in_use',
  'duplicate_variant',
  'axis_required',
  'axis_value_required',
  'attribute_is_axis',
  'not_an_axis',
  'option_in_use',
  'invalid_number',
  'too_many_pinned',
] as const
export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number]

export class DomainError extends Error {
  readonly code: DomainErrorCode
  constructor(code: DomainErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'DomainError'
    this.code = code
  }
}

/** Attributes of one inventory shown in lists ("Show in lists"). */
export const MAX_PINNED_ATTRIBUTES = 2

const MAX_NAME = 200
const MAX_UNIT = 16
const ATTRIBUTE_KINDS: readonly AttributeKind[] = ['text', 'enum', 'number']

// ---- normalization ----

const trimmed = (v: string | undefined) => (v === undefined ? undefined : v.trim())
const desc = (v: string | null | undefined) => {
  if (v === undefined) return undefined
  const t = v?.trim()
  return t ? t : null
}

/** Trims names, symbols, units, options and attribute values; turns an empty description and an empty shared or
 *  variant attribute value into null. Unset optional fields stay unset. */
export function normalizeCommand(c: Command): Command {
  const out: Record<string, unknown> = { ...c }
  const set = (k: string, v: unknown) => {
    if (k in out && v !== undefined) out[k] = v
  }
  set('name', trimmed((c as { name?: string }).name))
  set('symbol', trimmed((c as { symbol?: string }).symbol))
  set('description', desc((c as { description?: string | null }).description))
  if (c.type === 'attribute.create' || c.type === 'attribute.update') {
    set('options', c.options?.map((o) => o.trim()))
    set('unit', trimmed(c.unit))
  }
  // Units are for numbers only: a text or enum attribute never carries one.
  if (c.type === 'attribute.create' && c.kind !== 'number') {
    out.unit = ''
    out.siPrefixes = false
  }
  if (c.type === 'item.setAttribute' || c.type === 'variant.setAttribute') out.value = desc(c.value)
  const canon = (q: Quantity) => parseQuantity(q) ?? q
  if ('quantity' in c && typeof c.quantity === 'string') out.quantity = canon(c.quantity)
  if (c.type === 'stock.set') out.target = canon(c.target)
  if (c.type === 'item.create' && c.initialReceipt) {
    out.initialReceipt = { ...c.initialReceipt, quantity: canon(c.initialReceipt.quantity) }
  }
  if (c.type === 'item.create' || c.type === 'item.update') {
    set('tagIds', c.tagIds && [...new Set(c.tagIds)])
  }
  if (c.type === 'variant.createMany') {
    out.variants = c.variants.map((v) => ({ ...v, values: v.values.map((x) => ({ ...x, value: typeof x.value === 'string' ? x.value.trim() : x.value })) }))
  }
  return out as Command
}

// ---- validation ----

type Snap = InventorySnapshot
const fail = (code: DomainErrorCode): never => {
  throw new DomainError(code)
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function checkName(name: string | undefined) {
  if (name === undefined) return
  const t = name.trim()
  if (!t) fail('name_required')
  if (t.length > MAX_NAME) fail('name_too_long')
}

/** numeric(20,6) holds absolute values below 10^14. */
const QUANTITY_LIMIT = '100000000000000'

function parseQ(q: Quantity): Quantity {
  const canon = parseQuantity(q) ?? fail('invalid_quantity')
  if (cmpQ(canon.startsWith('-') ? canon.slice(1) : canon, QUANTITY_LIMIT) >= 0) fail('invalid_quantity')
  return canon
}
/** Returns the canonical quantity; throws invalid_quantity if unparseable or not > 0. */
function checkPositive(q: Quantity): Quantity {
  const canon = parseQ(q)
  if (cmpQ(canon, '0') <= 0) fail('invalid_quantity')
  return canon
}
function checkPrice(p: number | null) {
  if (p !== null && (!Number.isSafeInteger(p) || p < 0)) fail('invalid_price')
}
function checkUrl(u: string | null) {
  if (u !== null && !/^https?:\/\//i.test(u)) fail('invalid_url')
}
function checkPrefixes(p: number[] | undefined) {
  if (p?.some((x) => !Number.isInteger(x) || !Object.hasOwn(SI_PREFIXES, x))) fail('invalid_option')
}

function folderArchived(s: Snap, id: Id | null): boolean {
  const seen = new Set<Id>()
  let cur = id
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur)
    const f: Folder | undefined = s.folders.find((x) => x.id === cur)
    if (!f) return false
    if (f.archivedAt !== null) return true
    cur = f.parentId
  }
  return false
}
const itemArchived = (s: Snap, i: Item) => i.archivedAt !== null || folderArchived(s, i.folderId)
const variantArchived = (s: Snap, v: Variant) => {
  if (v.archivedAt !== null) return true
  const i = s.items.find((x) => x.id === v.itemId)
  return !!i && itemArchived(s, i)
}

function needFolder(s: Snap, id: Id): Folder {
  return s.folders.find((f) => f.id === id) ?? fail('not_found')
}
function needItem(s: Snap, id: Id): Item {
  return s.items.find((i) => i.id === id) ?? fail('not_found')
}
function needVariant(s: Snap, id: Id): Variant {
  return s.variants.find((v) => v.id === id) ?? fail('not_found')
}
function needInventory(s: Snap, id: Id) {
  if (s.inventory.id !== id) fail('not_found')
}
function activeFolder(s: Snap, id: Id | null) {
  if (id === null) return
  needFolder(s, id)
  if (folderArchived(s, id)) fail('archived')
}
function activeItem(s: Snap, id: Id): Item {
  const i = needItem(s, id)
  if (itemArchived(s, i)) fail('archived')
  return i
}
/** Item must be editable; a non-null variant must belong to it and be active. */
function activeBucket(s: Snap, itemId: Id, variantId: Id | null) {
  activeItem(s, itemId)
  if (variantId === null) return
  const v = needVariant(s, variantId)
  if (v.itemId !== itemId) fail('not_found')
  if (variantArchived(s, v)) fail('archived')
}

// ---- attributes and variant axes (spec 2026-11-11 variants §4.5–4.7) ----

function needAttribute(s: Snap, id: Id): Attribute {
  return s.attributes.find((a) => a.id === id) ?? fail('not_found')
}
function linkOf(s: Snap, itemId: Id, attributeId: Id): ItemAttribute | undefined {
  return s.itemAttributes.find((r) => r.itemId === itemId && r.attributeId === attributeId)
}
const isAxis = (s: Snap, itemId: Id, attributeId: Id) => (linkOf(s, itemId, attributeId)?.axisPosition ?? null) !== null

/** A non-empty value must fit the kind: a list option, a canonical number (§4.1), or text that is not blank. */
function checkValue(a: Attribute, value: string | null) {
  if (value === null) return
  if (a.kind === 'enum' && !a.options.includes(value)) fail('invalid_option')
  if (a.kind === 'number' && !isCanonicalNumber(value)) fail('invalid_number')
  if (a.kind === 'text' && value.trim() === '') fail('invalid_option')
}
function checkUnit(unit: string | undefined) {
  if (unit !== undefined && unit.trim().length > MAX_UNIT) fail('name_too_long')
}
/** A list option that is dropped must not be a value of any item or variant, archived ones included. */
function checkDroppedOptions(s: Snap, a: Attribute, options: string[] | undefined) {
  if (options === undefined || a.kind !== 'enum') return
  const dropped = new Set(a.options.filter((o) => !options.includes(o)))
  if (dropped.size === 0) return
  const used = (r: { attributeId: Id; value: string | null }) => r.attributeId === a.id && r.value !== null && dropped.has(r.value)
  if (s.itemAttributes.some(used) || s.variantAttributeValues.some(used)) fail('option_in_use')
}
/** Taking an axis off: refused when it is the last axis of an item with variants or leaves two variants equal. */
function checkAxisRemoval(s: Snap, itemId: Id, attributeId: Id) {
  const { blocked } = axisRemovalPreview(s, itemId, attributeId)
  if (blocked) fail(blocked)
}
function checkNewVariants(s: Snap, itemId: Id, variants: { id: Id; values: { attributeId: Id; value: string }[] }[]) {
  const axes = itemAxes(s, itemId)
  if (axes.length === 0) fail('axis_required')
  const batch: Map<Id, string | null>[] = []
  const ids = new Set<Id>()
  for (const v of variants) {
    if (ids.has(v.id)) fail('invalid_option')
    ids.add(v.id)
    const existing = s.variants.find((x) => x.id === v.id)
    if (existing && existing.itemId !== itemId) fail('invalid_option')
    const values = new Map<Id, string | null>()
    for (const { attributeId, value } of v.values) {
      needAttribute(s, attributeId)
      if (!axes.some((a) => a.id === attributeId)) fail('not_an_axis')
      if (values.has(attributeId)) fail('invalid_option')
      values.set(attributeId, value)
    }
    for (const a of axes) {
      const value = values.get(a.id) ?? null
      if (value === null || value.trim() === '') fail('axis_value_required')
      checkValue(a, value)
    }
    if (existing) {
      // A retried batch: the id is already this item's variant with these axis values; storage writes nothing new.
      const stored = new Map(s.variantAttributeValues.filter((r) => r.variantId === v.id).map((r) => [r.attributeId, r.value]))
      if (!axes.every((a) => sameAxisValue(a, stored.get(a.id) ?? null, values.get(a.id) ?? null))) fail('invalid_option')
    } else if (duplicateOf(s, itemId, values, v.id)) fail('duplicate_variant')
    if (batch.some((other) => axes.every((a) => sameAxisValue(a, other.get(a.id) ?? null, values.get(a.id) ?? null)))) {
      fail('duplicate_variant')
    }
    batch.push(values)
  }
}
function checkVariantValue(s: Snap, v: Variant, attributeId: Id, value: string | null) {
  const a = needAttribute(s, attributeId)
  if (!isAxis(s, v.itemId, attributeId)) fail('not_an_axis')
  checkValue(a, value)
  const values = new Map<Id, string | null>()
  for (const r of s.variantAttributeValues) if (r.variantId === v.id) values.set(r.attributeId, r.value)
  values.set(attributeId, value)
  if (duplicateOf(s, v.itemId, values, v.id)) fail('duplicate_variant')
}

function check(c: Command, s: Snap | null): void {
  if (c.type === 'inventory.create') {
    checkName(c.name)
    if (!Object.hasOwn(CURRENCIES, c.currency)) fail('invalid_currency')
    return
  }
  if (s === null) return fail('not_found')
  // An archived inventory is read-only; only restore and permanent deletion may touch it, and a retried archive of it.
  if (c.type !== 'restore' && c.type !== 'deletePermanently' && s.inventory.archivedAt !== null && !isOwnArchive(s, c)) {
    fail('archived')
  }

  switch (c.type) {
    case 'inventory.update':
      needInventory(s, c.id)
      if (s.inventory.archivedAt !== null) fail('archived')
      checkName(c.name)
      return
    case 'folder.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      activeFolder(s, c.parentId)
      return
    case 'folder.update': {
      needFolder(s, c.id)
      if (folderArchived(s, c.id)) fail('archived')
      checkName(c.name)
      return
    }
    case 'folder.move':
      needFolder(s, c.id)
      if (folderArchived(s, c.id)) fail('archived')
      if (c.parentId !== null) {
        needFolder(s, c.parentId)
        if (c.parentId === c.id || isInSubtree(s, c.id, c.parentId)) fail('folder_cycle')
        activeFolder(s, c.parentId)
      }
      return
    case 'item.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      activeFolder(s, c.folderId)
      if (!resolveUnit(c.unitKey, s.units)) fail('not_found')
      for (const t of c.tagIds) if (!s.tags.some((x) => x.id === t)) fail('not_found')
      if (c.initialReceipt) {
        checkPositive(c.initialReceipt.quantity)
        checkPrice(c.initialReceipt.totalPrice)
        checkUrl(c.initialReceipt.sourceUrl)
      }
      return
    case 'item.update':
      activeItem(s, c.id)
      checkName(c.name)
      if (c.folderId !== undefined) activeFolder(s, c.folderId)
      if (c.unitKey !== undefined && !resolveUnit(c.unitKey, s.units)) fail('not_found')
      for (const t of c.tagIds ?? []) if (!s.tags.some((x) => x.id === t)) fail('not_found')
      return
    case 'item.setAttribute': {
      activeItem(s, c.itemId)
      const a = needAttribute(s, c.attributeId)
      if (isAxis(s, c.itemId, c.attributeId)) fail('attribute_is_axis')
      checkValue(a, c.value)
      return
    }
    case 'item.removeAttribute':
      activeItem(s, c.itemId)
      needAttribute(s, c.attributeId)
      checkAxisRemoval(s, c.itemId, c.attributeId)
      return
    case 'item.addAxis':
      // Already an axis: the command changes nothing. A new axis never makes variants equal (§4.7).
      // First-variant rule (applied by storage, never rejected here): `firstVariantId` becomes a variant only when the
      // item has no variants, the attribute was shared with a non-empty value, AND the item has no other axis. With
      // another axis already present, only the role changes and the shared value is dropped.
      activeItem(s, c.itemId)
      needAttribute(s, c.attributeId)
      return
    case 'item.removeAxis':
      activeItem(s, c.itemId)
      needAttribute(s, c.attributeId)
      if (!isAxis(s, c.itemId, c.attributeId)) fail('not_an_axis')
      checkAxisRemoval(s, c.itemId, c.attributeId)
      return
    case 'item.reorderAxes': {
      activeItem(s, c.itemId)
      const axes = new Set(itemAxes(s, c.itemId).map((a) => a.id))
      const listed = new Set(c.attributeIds)
      if (listed.size !== c.attributeIds.length || listed.size !== axes.size || c.attributeIds.some((id) => !axes.has(id))) {
        fail('invalid_option')
      }
      return
    }
    case 'variant.createMany':
      activeItem(s, c.itemId)
      checkNewVariants(s, c.itemId, c.variants)
      return
    case 'variant.update': {
      const v = needVariant(s, c.id)
      if (variantArchived(s, v)) fail('archived')
      return
    }
    case 'variant.setAttribute': {
      const v = needVariant(s, c.variantId)
      if (variantArchived(s, v)) fail('archived')
      checkVariantValue(s, v, c.attributeId, c.value)
      return
    }
    case 'tag.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      // The tag this very command created (a retry after an unknown outcome, spec 4.7) is no duplicate of it.
      if (s.tags.some((t) => t.id !== c.id && same(t.name, c.name))) fail('duplicate_name')
      return
    case 'tag.rename':
      if (!s.tags.some((t) => t.id === c.id)) fail('not_found')
      checkName(c.name)
      if (s.tags.some((t) => t.id !== c.id && same(t.name, c.name))) fail('duplicate_name')
      return
    case 'tag.delete':
      if (!s.tags.some((t) => t.id === c.id)) fail('not_found')
      return
    case 'attribute.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      if (!ATTRIBUTE_KINDS.includes(c.kind)) fail('invalid_option')
      checkUnit(c.unit)
      return
    case 'attribute.update': {
      const a = needAttribute(s, c.id)
      checkName(c.name)
      checkUnit(c.unit)
      if (a.kind !== 'number' && ((c.unit !== undefined && c.unit.trim() !== '') || c.siPrefixes === true)) fail('invalid_option')
      checkDroppedOptions(s, a, c.options)
      // Only a new pin counts: unpinning, or keeping a pin, always passes.
      if (c.pinned === true && !a.pinned && s.attributes.filter((x) => x.pinned).length >= MAX_PINNED_ATTRIBUTES) {
        fail('too_many_pinned')
      }
      return
    }
    case 'attribute.delete': {
      needAttribute(s, c.id)
      const withVariants = new Set(s.variants.map((v) => v.itemId))
      if (s.itemAttributes.some((r) => r.attributeId === c.id && r.axisPosition !== null && withVariants.has(r.itemId))) {
        fail('attribute_is_axis')
      }
      return
    }
    case 'unit.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      checkName(c.symbol)
      checkPrefixes(c.prefixPowers)
      return
    case 'unit.update':
      if (!s.units.some((u) => u.id === c.id)) fail('not_found')
      checkName(c.name)
      checkName(c.symbol)
      checkPrefixes(c.prefixPowers)
      return
    case 'unit.delete':
      if (!s.units.some((u) => u.id === c.id)) fail('not_found')
      if (s.items.some((i) => i.unitKey === customUnitKey(c.id))) fail('unit_in_use')
      return
    case 'stock.receive':
      activeBucket(s, c.itemId, c.variantId)
      checkPositive(c.quantity)
      checkPrice(c.totalPrice)
      checkUrl(c.sourceUrl)
      return
    case 'stock.use':
    case 'stock.return':
      activeBucket(s, c.itemId, c.variantId)
      {
        const q = checkPositive(c.quantity)
        if (c.type === 'stock.use' && cmpQ(q, bucketStock(s, c.itemId, c.variantId).quantity) > 0) {
          fail('insufficient_stock')
        }
      }
      return
    case 'stock.set':
      activeBucket(s, c.itemId, c.variantId)
      if (cmpQ(parseQ(c.target), '0') < 0) fail('invalid_quantity')
      return
    case 'stock.transfer':
      activeBucket(s, c.itemId, c.fromVariantId)
      activeBucket(s, c.itemId, c.toVariantId)
      if (cmpQ(checkPositive(c.quantity), bucketStock(s, c.itemId, c.fromVariantId).quantity) > 0) {
        fail('insufficient_stock')
      }
      return
    case 'photo.add':
      activeBucket(s, c.itemId, c.variantId)
      if (c.variantId !== null && s.photos.some((p) => p.variantId === c.variantId)) fail('invalid_option')
      return
    case 'photo.remove':
      if (!s.photos.some((p) => p.id === c.id)) fail('not_found')
      return
    case 'photo.reorder':
      activeItem(s, c.itemId)
      for (const id of c.orderedIds) {
        if (!s.photos.some((p) => p.id === id && p.itemId === c.itemId)) fail('not_found')
      }
      {
        const own = s.photos.filter((p) => p.itemId === c.itemId).length
        if (new Set(c.orderedIds).size !== c.orderedIds.length || c.orderedIds.length !== own) fail('invalid_option')
      }
      return
    case 'archive':
      targetOf(s, c.target, c.id)
      if (isArchived(s, c.target, c.id) && !isOwnArchive(s, c)) fail('archived')
      return
    case 'restore': {
      const id = c.archiveId
      const found =
        s.inventory.archiveId === id ||
        s.folders.some((x) => x.archiveId === id) ||
        s.items.some((x) => x.archiveId === id) ||
        s.variants.some((x) => x.archiveId === id)
      if (!found) fail('not_found')
      return
    }
    case 'deletePermanently':
      if (targetOf(s, c.target, c.id).archivedAt === null) fail('not_archived')
      if (c.target === 'folder' && hasActiveInSubtree(s, c.id)) fail('not_archived')
      return
  }
}

function isArchived(s: Snap, target: 'inventory' | 'folder' | 'item' | 'variant', id: Id): boolean {
  if (target === 'inventory') return s.inventory.archivedAt !== null
  if (target === 'folder') return folderArchived(s, id)
  if (target === 'item') return itemArchived(s, needItem(s, id))
  return variantArchived(s, needVariant(s, id))
}

/** True if the folder's subtree holds a folder or an item that is not itself archived. */
function hasActiveInSubtree(s: Snap, folderId: Id): boolean {
  const ids = new Set<Id>([folderId])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of s.folders) {
      if (f.parentId !== null && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id)
        grew = true
      }
    }
  }
  return (
    s.folders.some((f) => ids.has(f.id) && f.archivedAt === null) ||
    s.items.some((i) => i.folderId !== null && ids.has(i.folderId) && i.archivedAt === null)
  )
}

/** An archive whose target already carries its archiveId: this very command landed before (a retry after an unknown
 *  outcome, spec 4.7). The source skips it (it only archives rows not archived yet). */
function isOwnArchive(s: Snap, c: Command): boolean {
  if (c.type !== 'archive') return false
  const row: Archivable | undefined =
    c.target === 'inventory'
      ? s.inventory.id === c.id
        ? s.inventory
        : undefined
      : c.target === 'folder'
        ? s.folders.find((f) => f.id === c.id)
        : c.target === 'item'
          ? s.items.find((i) => i.id === c.id)
          : s.variants.find((v) => v.id === c.id)
  return !!row && row.archivedAt !== null && row.archiveId === c.archiveId
}

function targetOf(s: Snap, target: 'inventory' | 'folder' | 'item' | 'variant', id: Id): { archivedAt: string | null } {
  if (target === 'inventory') {
    needInventory(s, id)
    return s.inventory
  }
  if (target === 'folder') return needFolder(s, id)
  if (target === 'item') return needItem(s, id)
  return needVariant(s, id)
}

/** Validates a command that has already been through normalizeCommand. `s` may be null only for inventory.create. */
export function validateCommand(c: Command, s: InventorySnapshot | null): DomainError | null {
  try {
    check(c, s)
    return null
  } catch (e) {
    if (e instanceof DomainError) return e
    throw e
  }
}
