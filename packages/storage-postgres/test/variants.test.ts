import { newId, patchSnapshot, type Command, type Id, type Quantity } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, itemCreate, makeStorage, sliceOf, TEST_ACTOR, variantsCreate } from './helpers'

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

/** variant.setValues from records: variant id -> attribute id -> value (null erases). */
const setValues = (itemId: Id, rows: [Id, Record<Id, string | null>][]): Command => ({
  type: 'variant.setValues',
  itemId,
  rows: rows.map(([variantId, values]) => ({
    variantId,
    values: Object.entries(values).map(([attributeId, value]) => ({ attributeId, value })),
  })),
})

describe('variant.setValues', () => {
  it('two variants trade their values in one write (Review Focus 1); the patch is the item slice', async () => {
    const { storage, run, load, valuesOf, inv, item, ohm, volt } = await setup()
    const [a, b] = [newId(), newId()]
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '10000', [volt]: '50' }]]))
    const copy = await load()
    const r = await run(setValues(item, [[a, { [ohm]: '10000' }], [b, { [ohm]: '4700' }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '10000', [volt]: '50' })
    expect(await valuesOf(b)).toEqual({ [ohm]: '4700', [volt]: '50' })
    expect(r.patch!.itemIds).toEqual([item])
    const fresh = await storage.loadInventory(inv)
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(fresh, item))
  })

  it('passes 100n·50V -> 220n·25V next to 220n·50V (C2)', async () => {
    const { run, valuesOf, item, ohm, volt } = await setup()
    const [a, b] = [newId(), newId()]
    await run(variantsCreate(item, [[a, { [ohm]: '100', [volt]: '50' }], [b, { [ohm]: '220', [volt]: '50' }]]))
    await run(setValues(item, [[a, { [ohm]: '220', [volt]: '25' }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '220', [volt]: '25' })
    expect(await valuesOf(b)).toEqual({ [ohm]: '220', [volt]: '50' })
  })

  it('erases a value with null and keeps the values a row does not name', async () => {
    const { run, valuesOf, item, ohm, volt } = await setup()
    const a = newId()
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await run(setValues(item, [[a, { [volt]: null }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700' })
    await run(setValues(item, [[a, { [volt]: '16' }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '16' })
  })

  it('writes only axes of the item in the database, and only to variants of that item', async () => {
    const { run, valuesOf, inv, item, ohm, volt, size } = await setup()
    const [a, other, x] = [newId(), newId(), newId()]
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await run(itemCreate(inv, other, 'Fuse'))
    await run({ type: 'item.addAxis', itemId: other, attributeId: ohm, firstVariantId: newId() })
    await run(variantsCreate(other, [[x, { [ohm]: '1' }]]))
    // Sent unvalidated, as from a copy that is behind.
    await run(setValues(item, [[a, { [size]: 'big', [volt]: '16' }], [x, { [ohm]: '2' }]]))
    expect(await valuesOf(a)).toEqual({ [ohm]: '4700', [volt]: '16' })
    expect(await valuesOf(x)).toEqual({ [ohm]: '1' })
  })

  it('refuses the whole write with conflict when the database would end with two equal variants (a copy that is behind)', async () => {
    const { storage, run, load, valuesOf, item, ohm, volt } = await setup()
    const [a, b, c] = [newId(), newId(), newId()]
    await run(variantsCreate(item, [[a, { [ohm]: '100', [volt]: '50' }], [b, { [ohm]: '220', [volt]: '50' }], [c, { [ohm]: '330', [volt]: '50' }]]))
    const before = await load()
    const rev = (await storage.listInventories()).rev
    // Sent unvalidated: c would equal b; a's change alone would be fine, but the command goes whole or not at all.
    await expect(run(setValues(item, [[a, { [ohm]: '470' }], [c, { [ohm]: '220' }]]))).rejects.toMatchObject({
      name: 'StorageError',
      code: 'conflict',
    })
    // Nothing written, not even the revision: the app syncs the copy that allowed it.
    expect(await load()).toEqual(before)
    expect((await storage.listInventories()).rev).toBe(rev)
    // An erased value equals only an empty one.
    await run(setValues(item, [[a, { [volt]: null }]]))
    await expect(run(setValues(item, [[b, { [ohm]: '100', [volt]: null }]]))).rejects.toMatchObject({ code: 'conflict' })
    expect(await valuesOf(b)).toEqual({ [ohm]: '220', [volt]: '50' })
    // The same storage writes on afterwards.
    await run(setValues(item, [[b, { [ohm]: '150' }]]))
    expect(await valuesOf(b)).toEqual({ [ohm]: '150', [volt]: '50' })
  })
})

describe('variant.createMany with initial receipts', () => {
  it('writes the variants and their receipts in one write; a variant without one gets no movement', async () => {
    const { storage, run, load, inv, item, ohm, volt } = await setup()
    const [a, b, m] = [newId(), newId(), newId()]
    const copy = await load()
    const r = await run({
      type: 'variant.createMany',
      itemId: item,
      variants: [
        { id: a, values: [{ attributeId: ohm, value: '100' }, { attributeId: volt, value: '50' }], initialReceipt: { movementId: m, quantity: '10' as Quantity } },
        { id: b, values: [{ attributeId: ohm, value: '100' }, { attributeId: volt, value: '16' }] },
      ],
    })
    const movements = await storage.loadMovements(item)
    expect(movements).toMatchObject([{ id: m, itemId: item, variantId: a, kind: 'receipt', quantity: '10', totalPrice: null, sourceUrl: null, note: null, createdBy: TEST_ACTOR.device }])
    const fresh = await storage.loadInventory(inv)
    expect(fresh.stock).toMatchObject([{ itemId: item, variantId: a, quantity: '10' }])
    expect(fresh.variants.map((v) => v.id).sort()).toEqual([a, b].sort())
    expect(sliceOf(patchSnapshot(copy, r.patch!), item)).toEqual(sliceOf(fresh, item))
    expect((await storage.loadAllMovements(inv)).map((x) => x.id)).toEqual([m])
  })

  it('a receipt the database refuses takes the variants with it: one transaction', async () => {
    const { storage, run, load, item, ohm, volt } = await setup()
    const a = newId()
    // Sent unvalidated: numeric(20,6) holds less than 10^14.
    await expect(
      run({
        type: 'variant.createMany',
        itemId: item,
        variants: [{ id: a, values: [{ attributeId: ohm, value: '100' }, { attributeId: volt, value: '50' }], initialReceipt: { movementId: newId(), quantity: '100000000000000' as Quantity } }],
      }),
    ).rejects.toMatchObject({ code: 'failed' })
    expect((await load()).variants).toEqual([])
    expect(await storage.loadMovements(item)).toEqual([])
  })

  it('an item with no axis in the database gets neither variants nor receipts', async () => {
    const { storage, run, load, inv } = await setup()
    const plain = newId()
    await run(itemCreate(inv, plain, 'Glue'))
    await run({
      type: 'variant.createMany',
      itemId: plain,
      variants: [{ id: newId(), values: [], initialReceipt: { movementId: newId(), quantity: '3' as Quantity } }],
    })
    expect((await load()).variants).toEqual([])
    expect(await storage.loadMovements(plain)).toEqual([])
  })
})
