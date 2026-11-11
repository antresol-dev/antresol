import { newId, StorageError, type Command, type InventoryStorage } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { openPostgresStorage } from '../src/storage'
import { attributeCreate, makeExecutor, TEST_ACTOR, variantsCreate } from './helpers'

interface Ctx {
  exec: PgExecutor
  storage: InventoryStorage
  inv: string
}

async function setup(): Promise<Ctx> {
  const exec = await makeExecutor()
  const { storage } = await openPostgresStorage(exec)
  const inv = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  return { exec, storage, inv }
}

const run = (c: Ctx, cmd: Command) => c.storage.apply(cmd, TEST_ACTOR)

async function folder(c: Ctx, parentId: string | null, name: string): Promise<string> {
  const id = newId()
  await run(c, { type: 'folder.create', id, inventoryId: c.inv, parentId, name, description: null })
  return id
}

async function item(c: Ctx, folderId: string | null, name: string, qty: string | null = null): Promise<string> {
  const id = newId()
  await run(c, {
    type: 'item.create',
    id,
    inventoryId: c.inv,
    folderId,
    name,
    description: null,
    unitKey: 'pcs',
    tagIds: [],
    initialReceipt: qty ? { movementId: newId(), quantity: qty, totalPrice: null, sourceUrl: null } : null,
  })
  return id
}

async function state(c: Ctx) {
  const s = await c.storage.loadInventory(c.inv)
  const f = (r: { id: string; archiveId: string | null; archivedAt: string | null }) => ({
    archiveId: r.archiveId,
    archived: r.archivedAt !== null,
  })
  return {
    folders: new Map(s.folders.map((r) => [r.id, f(r)])),
    items: new Map(s.items.map((r) => [r.id, f(r)])),
    variants: new Map(s.variants.map((r) => [r.id, f(r)])),
  }
}

const count = async (c: Ctx, table: string) =>
  Number((await c.exec.query<{ n: string }>({ text: `select count(*) as n from ${table}`, params: [] }))[0]!.n)

describe('archive and restore', () => {
  it('archives a folder subtree and restores it, ancestors included', async () => {
    const c = await setup()
    const F = await folder(c, null, 'F')
    const G = await folder(c, F, 'G')
    const i0 = await item(c, F, 'i0')
    const i1 = await item(c, F, 'i1')
    const i2 = await item(c, G, 'i2')
    const [A, B] = [newId(), newId()]

    await run(c, { type: 'archive', target: 'item', id: i0, archiveId: B })
    await run(c, { type: 'archive', target: 'folder', id: F, archiveId: A })
    let s = await state(c)
    for (const id of [F, G]) expect(s.folders.get(id)).toEqual({ archiveId: A, archived: true })
    for (const id of [i1, i2]) expect(s.items.get(id)).toEqual({ archiveId: A, archived: true })
    expect(s.items.get(i0)).toEqual({ archiveId: B, archived: true })

    await run(c, { type: 'restore', archiveId: A })
    s = await state(c)
    for (const id of [F, G]) expect(s.folders.get(id)).toEqual({ archiveId: null, archived: false })
    for (const id of [i1, i2]) expect(s.items.get(id)).toEqual({ archiveId: null, archived: false })
    expect(s.items.get(i0)).toEqual({ archiveId: B, archived: true })

    await run(c, { type: 'archive', target: 'folder', id: F, archiveId: A })
    await run(c, { type: 'restore', archiveId: B })
    s = await state(c)
    expect(s.items.get(i0)).toEqual({ archiveId: null, archived: false })
    expect(s.folders.get(F)).toEqual({ archiveId: null, archived: false })
    expect(s.folders.get(G)).toEqual({ archiveId: A, archived: true })
    for (const id of [i1, i2]) expect(s.items.get(id)).toEqual({ archiveId: A, archived: true })
  })

  it('restores the whole archived ancestor chain of an item restored on its own', async () => {
    const c = await setup()
    const F = await folder(c, null, 'F')
    const G = await folder(c, F, 'G')
    const i = await item(c, G, 'i')
    const [A, B] = [newId(), newId()]
    await run(c, { type: 'archive', target: 'item', id: i, archiveId: B })
    await run(c, { type: 'archive', target: 'folder', id: F, archiveId: A })
    await run(c, { type: 'restore', archiveId: B })
    const s = await state(c)
    expect(s.items.get(i)).toEqual({ archiveId: null, archived: false })
    for (const id of [F, G]) expect(s.folders.get(id)).toEqual({ archiveId: null, archived: false })
  })

  it('archives and restores a variant, and its archived parent item', async () => {
    const c = await setup()
    const F = await folder(c, null, 'F')
    const it1 = await item(c, F, 'it')
    const v1 = newId()
    const [C, D, E] = [newId(), newId(), newId()]
    await run(c, variantsCreate(it1, [[v1, {}]]))
    await run(c, { type: 'archive', target: 'variant', id: v1, archiveId: C })
    expect((await state(c)).variants.get(v1)).toEqual({ archiveId: C, archived: true })
    await run(c, { type: 'restore', archiveId: C })
    expect((await state(c)).variants.get(v1)).toEqual({ archiveId: null, archived: false })

    await run(c, { type: 'archive', target: 'variant', id: v1, archiveId: C })
    await run(c, { type: 'archive', target: 'item', id: it1, archiveId: D })
    await run(c, { type: 'archive', target: 'folder', id: F, archiveId: E })
    await run(c, { type: 'restore', archiveId: C })
    const s = await state(c)
    expect(s.variants.get(v1)).toEqual({ archiveId: null, archived: false })
    expect(s.items.get(it1)).toEqual({ archiveId: null, archived: false })
    expect(s.folders.get(F)).toEqual({ archiveId: null, archived: false })
  })

  it('archives and restores an inventory', async () => {
    const c = await setup()
    const A = newId()
    await run(c, { type: 'archive', target: 'inventory', id: c.inv, archiveId: A })
    expect((await c.storage.listInventories()).inventories[0]).toMatchObject({ archiveId: A })
    expect((await c.storage.listInventories()).inventories[0]!.archivedAt).not.toBeNull()
    await run(c, { type: 'restore', archiveId: A })
    expect((await c.storage.listInventories()).inventories[0]!.archivedAt).toBeNull()
  })
})

describe('deletePermanently', () => {
  it('deletes an archived item with all dependents but keeps the tag', async () => {
    const c = await setup()
    const tag = newId()
    const attr = newId()
    const axis = newId()
    await run(c, { type: 'tag.create', id: tag, inventoryId: c.inv, name: 't' })
    await run(c, attributeCreate(c.inv, attr, 'a'))
    await run(c, attributeCreate(c.inv, axis, 'b'))
    const it1 = newId()
    await run(c, {
      type: 'item.create', id: it1, inventoryId: c.inv, folderId: null, name: 'x', description: null, unitKey: 'pcs',
      tagIds: [tag], initialReceipt: { movementId: newId(), quantity: '2', totalPrice: null, sourceUrl: null },
    })
    const v = newId()
    await run(c, { type: 'item.addAxis', itemId: it1, attributeId: axis, firstVariantId: newId() })
    await run(c, variantsCreate(it1, [[v, { [axis]: 'z' }]]))
    await run(c, { type: 'item.setAttribute', itemId: it1, attributeId: attr, value: 'z' })
    expect(await count(c, 'variant_attribute_values')).toBe(1)
    await run(c, { type: 'photo.add', id: newId(), itemId: it1, variantId: v, provider: 'p', fileId: 'f', url: 'u' })

    await run(c, { type: 'deletePermanently', target: 'item', id: it1 })
    expect(await count(c, 'items')).toBe(1) // not archived: untouched

    await run(c, { type: 'archive', target: 'item', id: it1, archiveId: newId() })
    await run(c, { type: 'deletePermanently', target: 'item', id: it1 })
    for (const t of ['items', 'variants', 'movements', 'photos', 'item_tags', 'item_attributes', 'variant_attribute_values'])
      expect(await count(c, t), t).toBe(0)
    expect(await count(c, 'tags')).toBe(1)
  })

  it('deletes an archived variant by cascade', async () => {
    const c = await setup()
    const it1 = await item(c, null, 'x', '3')
    const v = newId()
    await run(c, variantsCreate(it1, [[v, {}]]))
    await run(c, { type: 'stock.receive', movementId: newId(), itemId: it1, variantId: v, quantity: '1', totalPrice: null, sourceUrl: null, note: null })
    await run(c, { type: 'archive', target: 'variant', id: v, archiveId: newId() })
    await run(c, { type: 'deletePermanently', target: 'variant', id: v })
    expect(await count(c, 'variants')).toBe(0)
    expect(await count(c, 'movements')).toBe(1)
    expect(await count(c, 'items')).toBe(1)
  })

  it('deletes an archived folder subtree with its items and leaves other folders', async () => {
    const c = await setup()
    const other = await folder(c, null, 'other')
    const otherItem = await item(c, other, 'oi')
    const F = await folder(c, null, 'F')
    const G = await folder(c, F, 'G')
    const ids = [await item(c, F, 'i0'), await item(c, F, 'i1'), await item(c, G, 'i2', '1')]

    await run(c, { type: 'deletePermanently', target: 'folder', id: F })
    expect(await count(c, 'folders')).toBe(3) // not archived: untouched

    await run(c, { type: 'archive', target: 'folder', id: F, archiveId: newId() })
    await run(c, { type: 'deletePermanently', target: 'folder', id: F })
    const s = await c.storage.loadInventory(c.inv)
    expect(s.folders.map((f) => f.id)).toEqual([other])
    expect(s.items.map((i) => i.id)).toEqual([otherItem])
    expect(ids).toHaveLength(3)
    expect(await count(c, 'movements')).toBe(0)
  })

  describe('folder with rows that were never archived (stale writes)', () => {
    async function expectRefused(c: Ctx, F: string) {
      const before = [await count(c, 'folders'), await count(c, 'items'), await count(c, 'movements')]
      const err = await run(c, { type: 'deletePermanently', target: 'folder', id: F }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(StorageError)
      expect((err as StorageError).code).toBe('failed')
      expect([await count(c, 'folders'), await count(c, 'items'), await count(c, 'movements')]).toEqual(before)
    }

    it('refuses and removes nothing when an active item sits in the archived folder', async () => {
      const c = await setup()
      const F = await folder(c, null, 'F')
      const archivedItem = await item(c, F, 'a', '1')
      await run(c, { type: 'archive', target: 'folder', id: F, archiveId: newId() })
      await item(c, F, 'stale', '2') // created from a stale snapshot, after the archive
      await expectRefused(c, F)
      expect((await state(c)).items.get(archivedItem)).toMatchObject({ archived: true })
    })

    it('refuses and removes nothing when an active subfolder sits in the archived folder', async () => {
      const c = await setup()
      const F = await folder(c, null, 'F')
      await item(c, F, 'a', '1')
      await run(c, { type: 'archive', target: 'folder', id: F, archiveId: newId() })
      await folder(c, F, 'stale')
      await expectRefused(c, F)
    })
  })

  it('deletes an archived inventory with everything in it', async () => {
    const c = await setup()
    const F = await folder(c, null, 'F')
    await item(c, F, 'i', '5')
    await run(c, { type: 'archive', target: 'inventory', id: c.inv, archiveId: newId() })
    await run(c, { type: 'deletePermanently', target: 'inventory', id: c.inv })
    expect((await c.storage.listInventories()).inventories).toEqual([])
    for (const t of ['movements', 'items', 'folders']) expect(await count(c, t), t).toBe(0)
  })
})
