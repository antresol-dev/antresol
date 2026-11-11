import { PGlite } from '@electric-sql/pglite'
import type { Actor, AttributeKind, Command, Id, InventorySnapshot, InventoryStorage } from '@graymatter/core'
import { afterEach } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { createPgliteExecutor } from '../src/executors/pglite'
import { openPostgresStorage } from '../src/storage'

export const TEST_ACTOR: Actor = { device: 'Test · Vitest' }

// Every database made here belongs to one test (they are all made inside tests): it is closed after that test, in each
// file that imports these helpers.
const open: PgExecutor[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((exec) => exec.close().catch(() => {})))
})

/** A fresh in-memory database, closed after the test. */
export async function makeExecutor(): Promise<PgExecutor> {
  const exec = createPgliteExecutor(new PGlite())
  open.push(exec)
  return exec
}

export async function makeStorage(): Promise<InventoryStorage> {
  const { storage } = await openPostgresStorage(await makeExecutor())
  return storage
}

// ---- command builders ----

export const itemCreate = (inventoryId: Id, id: Id, name = 'Resistor'): Command => ({
  type: 'item.create',
  id,
  inventoryId,
  folderId: null,
  name,
  description: null,
  unitKey: 'pcs',
  tagIds: [],
  initialReceipt: null,
})

/** A text or list attribute by default; pass `unit` / `siPrefixes` for a number. */
export const attributeCreate = (
  inventoryId: Id,
  id: Id,
  name: string,
  kind: AttributeKind = 'text',
  extra: { options?: string[]; unit?: string; siPrefixes?: boolean } = {},
): Command => ({
  type: 'attribute.create',
  id,
  inventoryId,
  name,
  kind,
  options: extra.options ?? [],
  unit: extra.unit ?? '',
  siPrefixes: extra.siPrefixes ?? false,
})

/** Variants by their axis values: one record per variant, attribute id -> value. */
export const variantsCreate = (itemId: Id, variants: [Id, Record<Id, string>][]): Command => ({
  type: 'variant.createMany',
  itemId,
  variants: variants.map(([id, values]) => ({
    id,
    values: Object.entries(values).map(([attributeId, value]) => ({ attributeId, value })),
  })),
})

// ---- comparison without row order ----

/** Patched rows are appended, a fresh load returns SQL order: compare with every array sorted by its key. Arrays inside
 *  rows (tagIds, options, prefixPowers) keep their order: both sides read them with the same query. */
export const sorted = <T>(rows: T[], key: (row: T) => string): T[] =>
  [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
const byId = (row: { id: Id }) => row.id

export type ItemRows = Pick<
  InventorySnapshot,
  'items' | 'variants' | 'itemAttributes' | 'variantAttributeValues' | 'photos' | 'stock'
>

export function normItemRows(s: ItemRows): ItemRows {
  return {
    items: sorted(s.items, byId),
    variants: sorted(s.variants, byId),
    itemAttributes: sorted(s.itemAttributes, (r) => `${r.itemId}|${r.attributeId}`),
    variantAttributeValues: sorted(s.variantAttributeValues, (r) => `${r.variantId}|${r.attributeId}`),
    photos: sorted(s.photos, byId),
    stock: sorted(s.stock, (l) => `${l.itemId}|${l.variantId ?? ''}`),
  }
}

export function normSnapshot(s: InventorySnapshot): InventorySnapshot {
  return {
    ...s,
    ...normItemRows(s),
    folders: sorted(s.folders, byId),
    tags: sorted(s.tags, byId),
    attributes: sorted(s.attributes, byId),
    units: sorted(s.units, byId),
  }
}

/** One item's slice, as a patch carries it. */
export function sliceOf(s: InventorySnapshot, itemId: Id): ItemRows {
  const variantIds = new Set(s.variants.filter((v) => v.itemId === itemId).map((v) => v.id))
  return normItemRows({
    items: s.items.filter((i) => i.id === itemId),
    variants: s.variants.filter((v) => v.itemId === itemId),
    itemAttributes: s.itemAttributes.filter((r) => r.itemId === itemId),
    variantAttributeValues: s.variantAttributeValues.filter((r) => variantIds.has(r.variantId)),
    photos: s.photos.filter((p) => p.itemId === itemId),
    stock: s.stock.filter((l) => l.itemId === itemId),
  })
}
