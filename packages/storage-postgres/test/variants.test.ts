import { newId, type Command } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, itemCreate, makeStorage, TEST_ACTOR, variantsCreate } from './helpers'

/** An item with two number axes, Resistance then Voltage, and a text attribute that is not attached. */
async function setup() {
  const storage = await makeStorage()
  const run = (c: Command) => storage.apply(c, TEST_ACTOR)
  const [inv, item, ohm, volt, size] = [newId(), newId(), newId(), newId(), newId()]
  await run({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' })
  await run(itemCreate(inv, item))
  await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
  await run(attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V' }))
  await run(attributeCreate(inv, size, 'Size'))
  await run({ type: 'item.addAxis', itemId: item, attributeId: ohm, firstVariantId: newId() })
  await run({ type: 'item.addAxis', itemId: item, attributeId: volt, firstVariantId: newId() })
  const load = () => storage.loadInventory(inv)
  const valuesOf = async (variantId: string) =>
    Object.fromEntries(
      (await load()).variantAttributeValues.filter((r) => r.variantId === variantId).map((r) => [r.attributeId, r.value]),
    )
  return { storage, run, load, valuesOf, inv, item, ohm, volt, size }
}

describe('variant.createMany', () => {
  it('writes the values on both axes and continues positions after the existing maximum', async () => {
    const { run, load, valuesOf, item, ohm, volt } = await setup()
    const [a, b, c] = [newId(), newId(), newId()]
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '1000', [volt]: '16' }]]))
    await run(variantsCreate(item, [[c, { [ohm]: '0.1', [volt]: '50' }]]))
    const { variants } = await load()
    expect(variants.map((v) => [v.id, v.position])).toEqual([[a, 0], [b, 1], [c, 2]])
    expect(variants[0]).not.toHaveProperty('name')
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '50' })
    expect(await valuesOf(b)).toEqual({ [ohm]: '1000', [volt]: '16' })
    expect(await valuesOf(c)).toEqual({ [ohm]: '0.1', [volt]: '50' })
  })

  it('stores no value for an attribute that is not an axis of the item in the database', async () => {
    const { run, valuesOf, item, ohm, size } = await setup()
    const a = newId()
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [size]: 'big' }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700' })
  })
})

describe('variant.update', () => {
  it('changes the description', async () => {
    const { storage, run, load, item, ohm, volt } = await setup()
    const a = newId()
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await storage.apply({ type: 'variant.update', id: a, description: 'Metal film' }, { device: 'Other' })
    expect((await load()).variants).toMatchObject([{ id: a, description: 'Metal film', updatedBy: 'Other' }])
  })
})

describe('variant.setAttribute', () => {
  it('sets, overwrites and erases an axis value', async () => {
    const { run, valuesOf, item, ohm, volt } = await setup()
    const a = newId()
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await run({ type: 'variant.setAttribute', variantId: a, attributeId: volt, value: '16' })
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '16' })
    await run({ type: 'variant.setAttribute', variantId: a, attributeId: volt, value: null })
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700' })
    await run({ type: 'variant.setAttribute', variantId: a, attributeId: volt, value: '25' })
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '25' })
  })

  it('writes nothing for an attribute that is not an axis of the item in the database', async () => {
    const { run, valuesOf, item, ohm, volt, size } = await setup()
    const a = newId()
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await run({ type: 'item.setAttribute', itemId: item, attributeId: size, value: 'big' })
    await run({ type: 'variant.setAttribute', variantId: a, attributeId: size, value: 'small' })
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '50' })
  })
})
