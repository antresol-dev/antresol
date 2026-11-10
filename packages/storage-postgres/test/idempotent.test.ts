import { newId, type Command, type Quantity } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

const q = (s: string) => s as Quantity

async function setup() {
  const storage = await makeStorage()
  const inv = newId()
  const tag = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  await storage.apply({ type: 'tag.create', id: tag, inventoryId: inv, name: 't' }, TEST_ACTOR)
  return { storage, inv, tag }
}

type Storage = Awaited<ReturnType<typeof setup>>['storage']

async function twice(storage: Storage, c: Command) {
  await storage.apply(c, TEST_ACTOR)
  await storage.apply(c, TEST_ACTOR)
}

async function plainItem(storage: Storage, inv: string) {
  const item = newId()
  await storage.apply(
    { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
    TEST_ACTOR,
  )
  return item
}

describe('replaying a command with client ids is a no-op', () => {
  it('item.create with tags and an initial receipt', async () => {
    const { storage, inv, tag } = await setup()
    const id = newId()
    await twice(storage, {
      type: 'item.create', id, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [tag],
      initialReceipt: { movementId: newId(), quantity: q('100'), totalPrice: 230, sourceUrl: null },
    })
    const snap = await storage.loadInventory(inv)
    expect(snap.items).toHaveLength(1)
    expect(snap.items[0]!.tagIds).toEqual([tag])
    expect(await storage.loadMovements(id)).toHaveLength(1)
  })

  it('item.create does not re-add tags removed after the first create', async () => {
    const { storage, inv, tag } = await setup()
    const id = newId()
    const create: Command = {
      type: 'item.create', id, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [tag], initialReceipt: null,
    }
    await storage.apply(create, TEST_ACTOR)
    await storage.apply({ type: 'item.update', id, tagIds: [] }, TEST_ACTOR)
    await storage.apply(create, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items[0]!.tagIds).toEqual([])
  })

  it('stock.receive, stock.transfer and stock.set', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const v = newId()
    await storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: v, name: 'v' }] }, TEST_ACTOR)
    const receive = (movementId: string, quantity: string): Command => ({
      type: 'stock.receive', movementId, itemId: item, variantId: null, quantity: q(quantity), totalPrice: null, sourceUrl: null, note: null,
    })
    await twice(storage, receive(newId(), '10'))
    expect(await storage.loadMovements(item)).toHaveLength(1)
    await twice(storage, {
      type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(), itemId: item, fromVariantId: null, toVariantId: v, quantity: q('4'),
    })
    expect(await storage.loadMovements(item)).toHaveLength(3)
    const set: Command = { type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: q('1'), note: null }
    await storage.apply(set, TEST_ACTOR)
    await storage.apply(receive(newId(), '5'), TEST_ACTOR)
    await storage.apply(set, TEST_ACTOR) // same id, but the delta is different now: still must not insert or throw
    expect((await storage.loadMovements(item)).filter((m) => m.kind === 'adjustment')).toHaveLength(1)
  })

  it('variant.createMany keeps positions', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [a, b] = [newId(), newId()]
    await twice(storage, { type: 'variant.createMany', itemId: item, variants: [{ id: a, name: 'a' }, { id: b, name: 'b' }] })
    expect((await storage.loadInventory(inv)).variants.map((x) => [x.id, x.position])).toEqual([[a, 0], [b, 1]])
  })

  it('photo.add keeps the first position', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [p1, p2] = [newId(), newId()]
    const add = (id: string): Command => ({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://x/${id}` })
    await storage.apply(add(p1), TEST_ACTOR)
    await storage.apply(add(p2), TEST_ACTOR)
    await storage.apply(add(p1), TEST_ACTOR)
    expect((await storage.loadInventory(inv)).photos.map((p) => [p.id, p.position])).toEqual([[p1, 0], [p2, 1]])
  })

  it('inventory, folder, tag, attribute and unit creates', async () => {
    const { storage, inv } = await setup()
    await twice(storage, { type: 'inventory.create', id: newId(), name: 'B', description: null, currency: 'USD' })
    expect(await storage.listInventories()).toHaveLength(2)
    await twice(storage, { type: 'folder.create', id: newId(), inventoryId: inv, parentId: null, name: 'F', description: null })
    await twice(storage, { type: 'tag.create', id: newId(), inventoryId: inv, name: 'again' })
    await twice(storage, { type: 'attribute.create', id: newId(), inventoryId: inv, name: 'Color', kind: 'text', options: [] })
    await twice(storage, { type: 'unit.create', id: newId(), inventoryId: inv, name: 'Roll', symbol: 'rl', prefixPowers: [] })
    const s = await storage.loadInventory(inv)
    expect([s.folders.length, s.tags.length, s.attributes.length, s.units.length]).toEqual([1, 2, 1, 1])
  })
})
