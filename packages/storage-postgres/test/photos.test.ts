import { newId } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

describe('photos', () => {
  it('adds at the end, reorders and removes', async () => {
    const storage = await makeStorage()
    const inv = newId()
    const item = newId()
    await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    await storage.apply(
      { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
      TEST_ACTOR,
    )
    const [p1, p2, p3] = [newId(), newId(), newId()]
    for (const id of [p1, p2, p3]) {
      await storage.apply({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://x/${id}` }, TEST_ACTOR)
    }
    const positions = async () => (await storage.loadInventory(inv)).photos.map((p) => [p.id, p.position])
    expect(await positions()).toEqual([[p1, 0], [p2, 1], [p3, 2]])
    await storage.apply({ type: 'photo.reorder', itemId: item, orderedIds: [p3, p1, p2] }, TEST_ACTOR)
    expect(await positions()).toEqual([[p3, 0], [p1, 1], [p2, 2]])
    await storage.apply({ type: 'photo.remove', id: p1 }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).photos).toHaveLength(2)
  })
})
