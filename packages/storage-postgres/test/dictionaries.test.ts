import { newId, type InventoryStorage } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

async function setup(): Promise<{ storage: InventoryStorage; inv: string }> {
  const storage = await makeStorage()
  const inv = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  return { storage, inv }
}

describe('tags', () => {
  it('creates, renames and deletes', async () => {
    const { storage, inv } = await setup()
    const id = newId()
    await storage.apply({ type: 'tag.create', id, inventoryId: inv, name: 'smd' }, TEST_ACTOR)
    await storage.apply({ type: 'tag.rename', id, name: 'SMD' }, { device: 'Other' })
    expect((await storage.loadInventory(inv)).tags).toMatchObject([{ id, name: 'SMD', updatedBy: 'Other', createdBy: 'Test · Vitest' }])
    await storage.apply({ type: 'tag.delete', id }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).tags).toEqual([])
  })
})

describe('attributes', () => {
  it('creates an enum attribute with options and updates it', async () => {
    const { storage, inv } = await setup()
    const id = newId()
    await storage.apply(
      { type: 'attribute.create', id, inventoryId: inv, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'] },
      TEST_ACTOR,
    )
    expect((await storage.loadInventory(inv)).attributes).toMatchObject([
      { id, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'] },
    ])
    await storage.apply({ type: 'attribute.update', id, options: ['DIP-8'] }, TEST_ACTOR)
    await storage.apply({ type: 'attribute.update', id, name: 'Pkg' }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).attributes).toMatchObject([{ name: 'Pkg', options: ['DIP-8'] }])
    await storage.apply({ type: 'attribute.delete', id }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).attributes).toEqual([])
  })
})

describe('custom units', () => {
  it('creates, updates and deletes', async () => {
    const { storage, inv } = await setup()
    const id = newId()
    await storage.apply({ type: 'unit.create', id, inventoryId: inv, name: 'Gram', symbol: 'g', prefixPowers: [-3, 3] }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).units).toMatchObject([
      { id, name: 'Gram', symbol: 'g', prefixPowers: [-3, 3] },
    ])
    await storage.apply({ type: 'unit.update', id, symbol: 'gr', prefixPowers: [3] }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).units).toMatchObject([{ symbol: 'gr', prefixPowers: [3] }])
    await storage.apply({ type: 'unit.delete', id }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).units).toEqual([])
  })
})
