import { newId, patchSnapshot, type Command, type Id, type InventorySnapshot, type Quantity } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import {
  attributeCreate,
  itemCreate,
  makeExecutor,
  normItemRows,
  normSnapshot,
  sizeAxis,
  sliceOf,
  TEST_ACTOR,
  variantsCreate,
} from './helpers'

async function setup() {
  const exec = await makeExecutor()
  const { storage } = await openPostgresStorage(exec)
  const run = (c: Command) => storage.apply(c, TEST_ACTOR)
  const inv = newId()
  await run({ type: 'inventory.create', id: inv, name: 'Main', description: null, currency: 'USD' })
  return { exec, storage, run, inv }
}

const photoAdd = (itemId: Id, id: Id, variantId: Id | null = null): Command => ({
  type: 'photo.add',
  id,
  itemId,
  variantId,
  provider: 'imgbb',
  fileId: id,
  url: `https://i.example/${id}`,
})

describe('apply result', () => {
  it('prevRev is the revision before the write and rev the one after', async () => {
    const { storage, run, inv } = await setup()
    const before = (await storage.listInventories()).rev
    const r = await run(itemCreate(inv, newId()))
    expect(r.prevRev).toBe(before)
    expect(r.rev).not.toBe(before)
    expect(r.rev).toBe((await storage.listInventories()).rev)
  })

  it("stock.receive returns the item's slice with the new stock line", async () => {
    const { storage, run, inv } = await setup()
    const item = newId()
    await run(itemCreate(inv, item))
    await run(itemCreate(inv, newId(), 'Other'))
    const r = await run({
      type: 'stock.receive', movementId: newId(), itemId: item, variantId: null,
      quantity: '5' as Quantity, totalPrice: 250, sourceUrl: null, note: null,
    })
    expect(r.patch).not.toBeNull()
    expect(r.patch!.inventoryId).toBe(inv)
    expect(r.patch!.itemIds).toEqual([item])
    expect(r.patch!.stock).toEqual([expect.objectContaining({ itemId: item, variantId: null, quantity: '5' })])
    expect(normItemRows(r.patch!)).toEqual(sliceOf(await storage.loadInventory(inv), item))
    expect(r.patch!.folders).toBeUndefined()
    expect(r.patch!.inventory).toBeUndefined()
  })

  it("photo.remove returns the item's slice without the photo", async () => {
    const { storage, run, inv } = await setup()
    const item = newId()
    const [p1, p2] = [newId(), newId()]
    await run(itemCreate(inv, item))
    await run(photoAdd(item, p1))
    await run(photoAdd(item, p2))
    const r = await run({ type: 'photo.remove', id: p1 })
    expect(r.patch!.inventoryId).toBe(inv)
    expect(r.patch!.itemIds).toEqual([item])
    expect(r.patch!.photos.map((p) => p.id)).toEqual([p2])
    expect(normItemRows(r.patch!)).toEqual(sliceOf(await storage.loadInventory(inv), item))
  })

  it("deletePermanently of a variant returns the item's slice without it", async () => {
    const { storage, run, inv } = await setup()
    const item = newId()
    const [v1, v2] = [newId(), newId()]
    const attr = newId()
    await run(itemCreate(inv, item))
    await run(attributeCreate(inv, attr, 'Size'))
    await run({ type: 'item.addAxis', itemId: item, attributeId: attr, firstVariantId: newId() })
    await run(variantsCreate(item, [[v1, { [attr]: 'S' }], [v2, { [attr]: 'M' }]]))
    await run({ type: 'variant.setAttribute', variantId: v1, attributeId: attr, value: 'small' })
    await run({ type: 'photo.add', id: newId(), itemId: item, variantId: v1, provider: 'imgbb', fileId: 'f', url: 'https://i.example/f' })
    await run({
      type: 'stock.receive', movementId: newId(), itemId: item, variantId: v1,
      quantity: '3' as Quantity, totalPrice: null, sourceUrl: null, note: null,
    })
    await run({ type: 'archive', target: 'variant', id: v1, archiveId: newId() })
    const r = await run({ type: 'deletePermanently', target: 'variant', id: v1 })
    expect(r.patch!.inventoryId).toBe(inv)
    expect(r.patch!.itemIds).toEqual([item])
    expect(r.patch!.variants.map((v) => v.id)).toEqual([v2])
    expect(r.patch!.variantAttributeValues).toEqual([{ variantId: v2, attributeId: attr, value: 'M' }])
    expect(r.patch!.photos).toEqual([])
    expect(r.patch!.stock.filter((l) => l.variantId === v1)).toEqual([])
    expect(normItemRows(r.patch!)).toEqual(sliceOf(await storage.loadInventory(inv), item))
  })

  it('deletePermanently of an item returns its id with no item row', async () => {
    const { run, inv } = await setup()
    const [item, size] = [newId(), newId()]
    await run(itemCreate(inv, item))
    for (const c of sizeAxis(inv, item, size)) await run(c)
    await run(variantsCreate(item, [[newId(), { [size]: 'S' }]]))
    await run(photoAdd(item, newId()))
    await run({ type: 'archive', target: 'item', id: item, archiveId: newId() })
    const r = await run({ type: 'deletePermanently', target: 'item', id: item })
    expect(r.patch).toEqual({
      inventoryId: inv,
      itemIds: [item],
      items: [],
      variants: [],
      itemAttributes: [],
      variantAttributeValues: [],
      photos: [],
      stock: [],
    })
  })

  it('folder.create returns the whole folders table with the new folder', async () => {
    const { storage, run, inv } = await setup()
    const [f1, f2] = [newId(), newId()]
    await run({ type: 'folder.create', id: f1, inventoryId: inv, parentId: null, name: 'Shelf', description: null })
    const r = await run({ type: 'folder.create', id: f2, inventoryId: inv, parentId: f1, name: 'Box', description: null })
    expect(r.patch!.inventoryId).toBe(inv)
    expect(r.patch!.itemIds).toEqual([])
    expect(r.patch!.folders!.map((f) => f.id).sort()).toEqual([f1, f2].sort())
    expect(r.patch!.folders).toEqual((await storage.loadInventory(inv)).folders)
    expect(r.patch!.tags).toBeUndefined()
  })

  it('inventory.update returns the inventory row', async () => {
    const { storage, run, inv } = await setup()
    const r = await run({ type: 'inventory.update', id: inv, name: 'Renamed' })
    expect(r.patch!.inventoryId).toBe(inv)
    expect(r.patch!.itemIds).toEqual([])
    expect(r.patch!.inventory).toEqual((await storage.loadInventory(inv)).inventory)
    expect(r.patch!.inventory!.name).toBe('Renamed')
  })

  it('inventory.create returns the new inventory row under its own id', async () => {
    const { storage, run } = await setup()
    const other = newId()
    const r = await run({ type: 'inventory.create', id: other, name: 'Second', description: null, currency: 'EUR' })
    expect(r.patch!.inventoryId).toBe(other)
    expect(r.patch!.inventory).toEqual((await storage.loadInventory(other)).inventory)
  })

  it('a wide command returns no patch', async () => {
    const { storage, run, inv } = await setup()
    const folder = newId()
    const archiveId = newId()
    await run({ type: 'folder.create', id: folder, inventoryId: inv, parentId: null, name: 'Shelf', description: null })
    const tag = newId()
    const attr = newId()
    const unit = newId()
    await run({ type: 'tag.create', id: tag, inventoryId: inv, name: 'red' })
    await run(attributeCreate(inv, attr, 'Size'))
    await run({ type: 'unit.create', id: unit, inventoryId: inv, name: 'Roll', symbol: 'roll', prefixPowers: [] })
    const doomed = newId()
    await run({ type: 'inventory.create', id: doomed, name: 'Doomed', description: null, currency: 'USD' })
    await run({ type: 'archive', target: 'inventory', id: doomed, archiveId: newId() })

    const wide: Command[] = [
      { type: 'archive', target: 'folder', id: folder, archiveId },
      { type: 'restore', archiveId },
      { type: 'archive', target: 'folder', id: folder, archiveId: newId() },
      { type: 'deletePermanently', target: 'folder', id: folder },
      { type: 'deletePermanently', target: 'inventory', id: doomed },
      { type: 'tag.delete', id: tag },
      { type: 'attribute.delete', id: attr },
      { type: 'unit.delete', id: unit },
    ]
    for (const c of wide) {
      const before = (await storage.listInventories()).rev
      const r = await run(c)
      expect(r.patch, c.type).toBeNull()
      expect(r.prevRev).toBe(before)
      expect(r.rev).toBe((await storage.listInventories()).rev)
    }
    const s = await storage.loadInventory(inv)
    expect([s.folders, s.tags, s.attributes, s.units]).toEqual([[], [], [], []])
  })

  it('a replayed command returns the same rows and a new revision', async () => {
    const { run, inv } = await setup()
    const item = newId()
    await run(itemCreate(inv, item))
    const receive: Command = {
      type: 'stock.receive', movementId: newId(), itemId: item, variantId: null,
      quantity: '2' as Quantity, totalPrice: 100, sourceUrl: null, note: null,
    }
    const first = await run(receive)
    const replay = await run(receive)
    expect(replay.patch).toEqual(first.patch)
    expect(replay.patch!.stock[0]!.quantity).toBe('2')
    expect(replay.prevRev).toBe(first.rev)
    expect(replay.rev).not.toBe(first.rev)
  })

  it('a write to an item that no longer exists returns no patch', async () => {
    const { run } = await setup()
    const r = await run({
      type: 'stock.receive', movementId: newId(), itemId: newId(), variantId: null,
      quantity: '1' as Quantity, totalPrice: null, sourceUrl: null, note: null,
    })
    expect(r.patch).toBeNull()
  })

  it('the patch does not grow with the inventory', async () => {
    const { exec, run, inv: big } = await setup()
    await exec.batch([
      sql`insert into items (id, inventory_id, name, created_by, updated_by)
          select gen_random_uuid(), ${big}, 'Bulk ' || n, 'T', 'T' from generate_series(1, 2000) as n`,
    ])
    const small = newId()
    await run({ type: 'inventory.create', id: small, name: 'Small', description: null, currency: 'USD' })

    const sizes = async (inventoryId: Id) => {
      const item = newId()
      const created = await run(itemCreate(inventoryId, item, 'Quick'))
      const photo = await run(photoAdd(item, newId()))
      return [JSON.stringify(created.patch).length, JSON.stringify(photo.patch).length]
    }
    const inBig = await sizes(big)
    const inSmall = await sizes(small)
    for (const [i, size] of inBig.entries()) {
      expect(size).toBeLessThanOrEqual(5000)
      expect(Math.abs(size - inSmall[i]!) / inSmall[i]!).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('apply result of attribute, axis and variant commands', () => {
  it("every item and variant command returns its item's slice and nothing else", async () => {
    const { storage, run, inv } = await setup()
    const [item, other, ohm, volt, size] = [newId(), newId(), newId(), newId(), newId()]
    const [a, b, first] = [newId(), newId(), newId()]
    await run(itemCreate(inv, item))
    await run(itemCreate(inv, other, 'Other'))
    await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
    await run(attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V' }))
    await run(attributeCreate(inv, size, 'Size'))
    await run({ type: 'item.setAttribute', itemId: other, attributeId: size, value: 'big' })

    const commands: Command[] = [
      { type: 'item.setAttribute', itemId: item, attributeId: ohm, value: '10000' },
      { type: 'item.addAxis', itemId: item, attributeId: ohm, firstVariantId: first },
      { type: 'item.addAxis', itemId: item, attributeId: volt, firstVariantId: newId() },
      variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '1000', [volt]: '50' }]]),
      { type: 'variant.update', id: a, description: 'Metal film' },
      { type: 'variant.setAttribute', variantId: first, attributeId: volt, value: '50' },
      { type: 'variant.setAttribute', variantId: b, attributeId: volt, value: null },
      { type: 'variant.setAttribute', variantId: b, attributeId: volt, value: '50' },
      { type: 'item.addAxis', itemId: item, attributeId: size, firstVariantId: newId() },
      { type: 'item.reorderAxes', itemId: item, attributeIds: [size, volt, ohm] },
      { type: 'item.removeAxis', itemId: item, attributeId: volt },
      { type: 'item.setAttribute', itemId: item, attributeId: volt, value: '16' },
      { type: 'item.removeAttribute', itemId: item, attributeId: size },
      { type: 'item.removeAttribute', itemId: item, attributeId: volt },
    ]
    for (const c of commands) {
      const r = await run(c)
      const fresh = await storage.loadInventory(inv)
      expect(r.patch, c.type).not.toBeNull()
      expect(r.patch!.inventoryId).toBe(inv)
      expect(r.patch!.itemIds, c.type).toEqual([item])
      expect(normItemRows(r.patch!), c.type).toEqual(sliceOf(fresh, item))
      for (const table of ['inventory', 'folders', 'tags', 'attributes', 'units'] as const) {
        expect(r.patch![table], `${c.type} ${table}`).toBeUndefined()
      }
    }
    const s = await storage.loadInventory(inv)
    // The first variant came from the shared Resistance value.
    expect(s.variants.map((v) => v.id).sort()).toEqual([a, b, first].sort())
    expect(s.itemAttributes.filter((r) => r.itemId === item)).toEqual([
      { itemId: item, attributeId: ohm, value: null, axisPosition: 0 },
    ])
  })

  it('attribute.create and attribute.update return the attributes table', async () => {
    const { storage, run, inv } = await setup()
    const [ohm, size] = [newId(), newId()]
    await run(attributeCreate(inv, size, 'Size'))
    const created = await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
    expect(created.patch!.itemIds).toEqual([])
    expect(created.patch!.attributes).toEqual((await storage.loadInventory(inv)).attributes)
    expect(created.patch!.attributes!.map((a) => a.id).sort()).toEqual([ohm, size].sort())
    const updated = await run({ type: 'attribute.update', id: ohm, unit: 'kΩ', siPrefixes: false })
    expect(updated.patch!.itemIds).toEqual([])
    expect(updated.patch!.attributes).toEqual((await storage.loadInventory(inv)).attributes)
    expect(updated.patch!.attributes!.find((a) => a.id === ohm)).toMatchObject({ unit: 'kΩ', siPrefixes: false })
    expect(updated.patch!.items).toEqual([])
  })

  it('createMany on two axes: the patched copy equals the snapshot after a reload', async () => {
    const { storage, run, inv } = await setup()
    const [item, cap, volt] = [newId(), newId(), newId()]
    let copy: InventorySnapshot = await storage.loadInventory(inv)
    const step = async (c: Command) => {
      const r = await run(c)
      copy = patchSnapshot(copy, r.patch!)
    }
    await step(itemCreate(inv, item, 'Capacitor'))
    await step(attributeCreate(inv, cap, 'Capacitance', 'number', { unit: 'F', siPrefixes: true }))
    await step(attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V', siPrefixes: true }))
    await step({ type: 'item.addAxis', itemId: item, attributeId: cap, firstVariantId: newId() })
    await step({ type: 'item.addAxis', itemId: item, attributeId: volt, firstVariantId: newId() })
    await step(
      variantsCreate(item, [
        [newId(), { [cap]: '0.0000001', [volt]: '50' }],
        [newId(), { [cap]: '0.0000001', [volt]: '16' }],
      ]),
    )
    const fresh = await storage.loadInventory(inv)
    expect(fresh.variantAttributeValues).toHaveLength(4)
    expect(normSnapshot(copy)).toEqual(normSnapshot(fresh))
  })
})
