import { newId } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

async function setup() {
  const storage = await makeStorage()
  const inv = newId()
  const item = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  await storage.apply(
    { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
    TEST_ACTOR,
  )
  return { storage, inv, item }
}

describe('variants', () => {
  it('createMany continues positions after the existing maximum', async () => {
    const { storage, inv, item } = await setup()
    const [a, b, c] = [newId(), newId(), newId()]
    await storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: a, name: 'a' }, { id: b, name: 'b' }] }, TEST_ACTOR)
    await storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: c, name: 'c' }] }, TEST_ACTOR)
    const { variants } = await storage.loadInventory(inv)
    expect(variants.map((v) => [v.id, v.position])).toEqual([[a, 0], [b, 1], [c, 2]])
  })

  it('update changes the name', async () => {
    const { storage, inv, item } = await setup()
    const a = newId()
    await storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: a, name: 'a' }] }, TEST_ACTOR)
    await storage.apply({ type: 'variant.update', id: a, name: 'renamed' }, { device: 'Other' })
    expect((await storage.loadInventory(inv)).variants).toMatchObject([{ id: a, name: 'renamed', updatedBy: 'Other' }])
  })
})
