import type { Command } from './commands'
import type { Id } from './ids'
import { CURRENCIES } from './money'
import type { Folder, InventorySnapshot, Item, Variant } from './model'
import { bucketStock } from './stock'
import { cmpQ, parseQuantity, type Quantity } from './quantity'
import { customUnitKey, resolveUnit, SI_PREFIXES } from './units'
import { isInSubtree } from './tree'

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

const MAX_NAME = 200

// ---- normalization ----

const trimmed = (v: string | undefined) => (v === undefined ? undefined : v.trim())
const desc = (v: string | null | undefined) => {
  if (v === undefined) return undefined
  const t = v?.trim()
  return t ? t : null
}

/** Trims names, symbols and options; turns an empty description into null. Unset optional fields stay unset. */
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
  }
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
    out.variants = c.variants.map((v) => ({ ...v, name: v.name.trim() }))
  }
  return out as Command
}

/** Splits on commas, semicolons and newlines; trims; drops empties and case-insensitive duplicates. */
export function splitVariantNames(input: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of input.split(/[,;\n]/)) {
    const name = part.trim()
    const key = name.toLowerCase()
    if (name && !seen.has(key)) {
      seen.add(key)
      out.push(name)
    }
  }
  return out
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
function checkAttributeValue(s: Snap, attributeId: Id, value: string | null) {
  const a = s.attributes.find((x) => x.id === attributeId) ?? fail('not_found')
  if (a.kind === 'enum' && value !== null && !a.options.includes(value)) fail('invalid_option')
}
function checkVariantNames(s: Snap, itemId: Id, names: { id: string; name: string }[]) {
  const taken = s.variants.filter((v) => v.itemId === itemId).map((v) => ({ id: v.id, name: v.name }))
  for (const n of names) {
    checkName(n.name)
    if (taken.some((t) => t.id !== n.id && same(t.name, n.name))) fail('duplicate_name')
    taken.push(n)
  }
}

function check(c: Command, s: Snap | null): void {
  if (c.type === 'inventory.create') {
    checkName(c.name)
    if (!Object.hasOwn(CURRENCIES, c.currency)) fail('invalid_currency')
    return
  }
  if (s === null) return fail('not_found')
  // An archived inventory is read-only; only restore and permanent deletion may touch it.
  if (c.type !== 'restore' && c.type !== 'deletePermanently' && s.inventory.archivedAt !== null) fail('archived')

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
    case 'item.setAttribute':
      activeItem(s, c.itemId)
      checkAttributeValue(s, c.attributeId, c.value)
      return
    case 'item.removeAttribute':
      activeItem(s, c.itemId)
      if (!s.attributes.some((a) => a.id === c.attributeId)) fail('not_found')
      return
    case 'variant.createMany':
      activeItem(s, c.itemId)
      checkVariantNames(s, c.itemId, c.variants)
      return
    case 'variant.update': {
      const v = needVariant(s, c.id)
      if (variantArchived(s, v)) fail('archived')
      if (c.name !== undefined) checkVariantNames(s, v.itemId, [{ id: v.id, name: c.name }])
      return
    }
    case 'variant.setAttribute': {
      const v = needVariant(s, c.variantId)
      if (variantArchived(s, v)) fail('archived')
      checkAttributeValue(s, c.attributeId, c.value)
      return
    }
    case 'tag.create':
      needInventory(s, c.inventoryId)
      checkName(c.name)
      if (s.tags.some((t) => same(t.name, c.name))) fail('duplicate_name')
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
      return
    case 'attribute.update':
      if (!s.attributes.some((a) => a.id === c.id)) fail('not_found')
      checkName(c.name)
      return
    case 'attribute.delete':
      if (!s.attributes.some((a) => a.id === c.id)) fail('not_found')
      return
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
      if (isArchived(s, c.target, c.id)) fail('archived')
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
