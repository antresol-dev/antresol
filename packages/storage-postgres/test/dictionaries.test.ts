import { newId, type Command, type InventoryStorage } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, itemCreate, makeStorage, TEST_ACTOR, variantsCreate } from './helpers'

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
      attributeCreate(inv, id, 'Package', 'enum', { options: ['DIP-8', 'SOIC-8'] }),
      TEST_ACTOR,
    )
    expect((await storage.loadInventory(inv)).attributes).toMatchObject([
      { id, name: 'Package', kind: 'enum', options: ['DIP-8', 'SOIC-8'], unit: '', siPrefixes: false },
    ])
    await storage.apply({ type: 'attribute.update', id, options: ['DIP-8'] }, TEST_ACTOR)
    await storage.apply({ type: 'attribute.update', id, name: 'Pkg' }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).attributes).toMatchObject([{ name: 'Pkg', options: ['DIP-8'] }])
    await storage.apply({ type: 'attribute.delete', id }, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).attributes).toEqual([])
  })

  it('creates a number attribute with its unit and prefix setting', async () => {
    const { storage, inv } = await setup()
    const id = newId()
    await storage.apply(attributeCreate(inv, id, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }), TEST_ACTOR)
    expect((await storage.loadInventory(inv)).attributes).toMatchObject([
      { id, name: 'Resistance', kind: 'number', options: [], unit: 'Ω', siPrefixes: true },
    ])
  })

  it('a new unit or prefix setting leaves the stored values as they are', async () => {
    const { storage, inv } = await setup()
    const run = (c: Command) => storage.apply(c, TEST_ACTOR)
    const [ohm, cap, item, other, variant] = [newId(), newId(), newId(), newId(), newId()]
    await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
    await run(attributeCreate(inv, cap, 'Capacitance', 'number', { unit: 'F', siPrefixes: true }))
    await run(itemCreate(inv, item))
    await run(itemCreate(inv, other, 'Capacitor'))
    await run({ type: 'item.setAttribute', itemId: item, attributeId: ohm, value: '4700' })
    await run({ type: 'item.addAxis', itemId: other, attributeId: cap, firstVariantId: newId() })
    await run(variantsCreate(other, [[variant, { [cap]: '0.0000001' }]]))
    const before = await storage.loadInventory(inv)

    await run({ type: 'attribute.update', id: ohm, unit: 'kΩ', siPrefixes: false })
    await run({ type: 'attribute.update', id: cap, unit: '' })
    const after = await storage.loadInventory(inv)
    expect(after.attributes.find((a) => a.id === ohm)).toMatchObject({ unit: 'kΩ', siPrefixes: false })
    expect(after.attributes.find((a) => a.id === cap)).toMatchObject({ unit: '', siPrefixes: true })
    expect(after.itemAttributes).toEqual(before.itemAttributes)
    expect(after.variantAttributeValues).toEqual(before.variantAttributeValues)
    expect(after.variantAttributeValues).toEqual([{ variantId: variant, attributeId: cap, value: '0.0000001' }])
  })
})

describe('pinned attributes', () => {
  it('pins and unpins; a pin beyond the second is skipped whatever copy it was validated on', async () => {
    const { storage, inv } = await setup()
    const ids = [newId(), newId(), newId()] as const
    for (const [i, id] of ids.entries()) await storage.apply(attributeCreate(inv, id, `A${i}`), TEST_ACTOR)
    const load = async () => (await storage.loadInventory(inv)).attributes
    const pinned = async () => (await load()).filter((a) => a.pinned).map((a) => a.id).sort()
    const pin = (id: string, value = true) => storage.apply({ type: 'attribute.update', id, pinned: value }, TEST_ACTOR)
    expect(await pinned()).toEqual([])

    const first = await pin(ids[0])
    expect(first.patch?.attributes?.find((a) => a.id === ids[0])).toMatchObject({ pinned: true })
    await pin(ids[1])
    // A third pin (another device validated it on a copy from before the second): the pin is skipped, the rest applies.
    const third = await storage.apply({ type: 'attribute.update', id: ids[2], name: 'Third', pinned: true }, TEST_ACTOR)
    expect(await pinned()).toEqual([ids[0], ids[1]].sort())
    expect((await load()).find((a) => a.id === ids[2])).toMatchObject({ name: 'Third', pinned: false })
    expect(third.patch?.attributes?.find((a) => a.id === ids[2])).toMatchObject({ name: 'Third', pinned: false })
    // Sent again, a pin stays; an update without `pinned` leaves it as it is.
    await pin(ids[1])
    await storage.apply({ type: 'attribute.update', id: ids[1], name: 'Second' }, TEST_ACTOR)
    expect(await pinned()).toEqual([ids[0], ids[1]].sort())
    // Unpinning always applies, and frees a place.
    await pin(ids[0], false)
    expect(await pinned()).toEqual([ids[1]])
    await pin(ids[2])
    expect(await pinned()).toEqual([ids[1], ids[2]].sort())

    // Pins count per inventory.
    const other = newId()
    await storage.apply({ type: 'inventory.create', id: other, name: 'B', description: null, currency: 'USD' }, TEST_ACTOR)
    const theirs = [newId(), newId()]
    for (const id of theirs) {
      await storage.apply(attributeCreate(other, id, 'X'), TEST_ACTOR)
      await pin(id)
    }
    expect((await storage.loadInventory(other)).attributes.every((a) => a.pinned)).toBe(true)
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
