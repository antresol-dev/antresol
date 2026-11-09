import { newId, type InventoryStorage } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

async function setup(): Promise<{ storage: InventoryStorage; inv: string }> {
  const storage = await makeStorage()
  const inv = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  return { storage, inv }
}

describe('folders', () => {
  it('creates, updates and moves', async () => {
    const { storage, inv } = await setup()
    const a = newId()
    const b = newId()
    await storage.apply({ type: 'folder.create', id: a, inventoryId: inv, parentId: null, name: 'Parts', description: null }, TEST_ACTOR)
    await storage.apply({ type: 'folder.create', id: b, inventoryId: inv, parentId: a, name: 'Chips', description: 'ICs' }, TEST_ACTOR)
    let snap = await storage.loadInventory(inv)
    expect(snap.folders.find((f) => f.id === b)).toMatchObject({ name: 'Chips', parentId: a, description: 'ICs', archivedAt: null })

    await storage.apply({ type: 'folder.update', id: b, name: 'ICs', description: null }, TEST_ACTOR)
    await storage.apply({ type: 'folder.move', id: b, parentId: null }, { device: 'Other' })
    snap = await storage.loadInventory(inv)
    expect(snap.folders.find((f) => f.id === b)).toMatchObject({ name: 'ICs', parentId: null, description: null, updatedBy: 'Other' })
  })
})
