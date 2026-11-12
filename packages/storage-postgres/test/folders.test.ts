import { newId, type InventoryStorage } from '@antresol/core'
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

  it('ignores a move into itself or into a descendant (crossing moves from stale snapshots)', async () => {
    const { storage, inv } = await setup()
    const [f, g] = [newId(), newId()]
    for (const id of [f, g]) {
      await storage.apply({ type: 'folder.create', id, inventoryId: inv, parentId: null, name: id, description: null }, TEST_ACTOR)
    }
    await storage.apply({ type: 'folder.move', id: f, parentId: g }, TEST_ACTOR)
    await storage.apply({ type: 'folder.move', id: g, parentId: f }, TEST_ACTOR) // would close a cycle
    await storage.apply({ type: 'folder.move', id: f, parentId: f }, TEST_ACTOR)
    const folders = (await storage.loadInventory(inv)).folders
    expect(folders.find((x) => x.id === g)!.parentId).toBeNull()
    expect(folders.find((x) => x.id === f)!.parentId).toBe(g)
  })
})
