import { newId, type InventoryStorage } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

async function setup(): Promise<{ storage: InventoryStorage; inv: string; t1: string; t2: string }> {
  const storage = await makeStorage()
  const inv = newId()
  const t1 = newId()
  const t2 = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  await storage.apply({ type: 'tag.create', id: t1, inventoryId: inv, name: 't1' }, TEST_ACTOR)
  await storage.apply({ type: 'tag.create', id: t2, inventoryId: inv, name: 't2' }, TEST_ACTOR)
  return { storage, inv, t1, t2 }
}

function createItem(inv: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'item.create' as const,
    id,
    inventoryId: inv,
    folderId: null,
    name: 'Resistor',
    description: null,
    unitKey: 'pcs',
    tagIds: [],
    initialReceipt: null,
    ...extra,
  }
}

describe('item.create', () => {
  it('inserts tags and the initial receipt in one batch', async () => {
    const { storage, inv, t1 } = await setup()
    const id = newId()
    await storage.apply(
      createItem(inv, id, {
        tagIds: [t1],
        initialReceipt: { movementId: newId(), quantity: '100', totalPrice: 230, sourceUrl: 'https://aliexpress.com/item/1' },
      }),
      TEST_ACTOR,
    )
    const snap = await storage.loadInventory(inv)
    expect(snap.items[0]!.tagIds).toEqual([t1])
    expect(snap.stock).toMatchObject([
      { variantId: null, quantity: '100', pricedQuantity: '100', pricedTotal: 230, lastPriced: { totalPrice: 230 } },
    ])
  })

  it('has no stock without a receipt', async () => {
    const { storage, inv } = await setup()
    await storage.apply(createItem(inv, newId()), TEST_ACTOR)
    expect((await storage.loadInventory(inv)).stock).toEqual([])
  })
})

describe('item.update', () => {
  it('replaces the tag set', async () => {
    const { storage, inv, t1, t2 } = await setup()
    const id = newId()
    await storage.apply(createItem(inv, id, { tagIds: [t1] }), TEST_ACTOR)
    await storage.apply({ type: 'item.update', id, tagIds: [t2] }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items[0]!.tagIds).toEqual([t2])
  })

  it('moves the item to the root with folderId null', async () => {
    const { storage, inv } = await setup()
    const folder = newId()
    const id = newId()
    await storage.apply({ type: 'folder.create', id: folder, inventoryId: inv, parentId: null, name: 'F', description: null }, TEST_ACTOR)
    await storage.apply(createItem(inv, id, { folderId: folder }), TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items[0]!.folderId).toBe(folder)
    await storage.apply({ type: 'item.update', id, folderId: null }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items[0]!.folderId).toBeNull()
  })
})

describe('attribute values', () => {
  async function withAttr() {
    const ctx = await setup()
    const item = newId()
    const v = newId()
    const attr = newId()
    await ctx.storage.apply(createItem(ctx.inv, item), TEST_ACTOR)
    await ctx.storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: v, name: 'a' }] }, TEST_ACTOR)
    await ctx.storage.apply(
      { type: 'attribute.create', id: attr, inventoryId: ctx.inv, name: 'Pkg', kind: 'text', options: [] },
      TEST_ACTOR,
    )
    return { ...ctx, item, v, attr }
  }

  it('item.setAttribute and variant.setAttribute upsert', async () => {
    const { storage, inv, item, v, attr } = await withAttr()
    await storage.apply({ type: 'item.setAttribute', itemId: item, attributeId: attr, value: 'x' }, TEST_ACTOR)
    await storage.apply({ type: 'item.setAttribute', itemId: item, attributeId: attr, value: 'y' }, TEST_ACTOR)
    await storage.apply({ type: 'variant.setAttribute', variantId: v, attributeId: attr, value: 'p' }, TEST_ACTOR)
    await storage.apply({ type: 'variant.setAttribute', variantId: v, attributeId: attr, value: 'q' }, TEST_ACTOR)
    const snap = await storage.loadInventory(inv)
    expect(snap.itemAttributes).toEqual([{ itemId: item, attributeId: attr, value: 'y' }])
    expect(snap.variantAttributeValues).toEqual([{ variantId: v, attributeId: attr, value: 'q' }])
  })

  it('item.removeAttribute removes the item row and variant values', async () => {
    const { storage, inv, item, v, attr } = await withAttr()
    await storage.apply({ type: 'item.setAttribute', itemId: item, attributeId: attr, value: 'x' }, TEST_ACTOR)
    await storage.apply({ type: 'variant.setAttribute', variantId: v, attributeId: attr, value: 'p' }, TEST_ACTOR)
    await storage.apply({ type: 'item.removeAttribute', itemId: item, attributeId: attr }, TEST_ACTOR)
    const snap = await storage.loadInventory(inv)
    expect(snap.itemAttributes).toEqual([])
    expect(snap.variantAttributeValues).toEqual([])
  })

  it('attribute.delete removes all values', async () => {
    const { storage, inv, item, v, attr } = await withAttr()
    await storage.apply({ type: 'item.setAttribute', itemId: item, attributeId: attr, value: 'x' }, TEST_ACTOR)
    await storage.apply({ type: 'variant.setAttribute', variantId: v, attributeId: attr, value: 'p' }, TEST_ACTOR)
    await storage.apply({ type: 'attribute.delete', id: attr }, TEST_ACTOR)
    const snap = await storage.loadInventory(inv)
    expect(snap.itemAttributes).toEqual([])
    expect(snap.variantAttributeValues).toEqual([])
  })
})
