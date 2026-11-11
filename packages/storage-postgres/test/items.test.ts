import {
  newId,
  normalizeCommand,
  validateCommand,
  type Command,
  type Id,
  type InventorySnapshot,
  type InventoryStorage,
} from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, makeStorage, TEST_ACTOR, variantsCreate } from './helpers'

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

/** An item and four attributes: Resistance (number, Ω, prefixes), Voltage (number, V), Color (list), Size (text). */
async function withAttributes() {
  const ctx = await setup()
  const run = (c: Command) => ctx.storage.apply(c, TEST_ACTOR)
  const item = newId()
  const [ohm, volt, color, size] = [newId(), newId(), newId(), newId()]
  await run(createItem(ctx.inv, item))
  await run(attributeCreate(ctx.inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
  await run(attributeCreate(ctx.inv, volt, 'Voltage', 'number', { unit: 'V' }))
  await run(attributeCreate(ctx.inv, color, 'Color', 'enum', { options: ['red', 'blue'] }))
  await run(attributeCreate(ctx.inv, size, 'Size'))
  const load = () => ctx.storage.loadInventory(ctx.inv)
  /** The item's attributes: attribute id -> [axisPosition, value]. */
  const links = async () =>
    Object.fromEntries(
      (await load()).itemAttributes.filter((r) => r.itemId === item).map((r) => [r.attributeId, [r.axisPosition, r.value]]),
    )
  /** One attribute's variant values: variant id -> value. */
  const values = async (attributeId: Id) =>
    Object.fromEntries(
      (await load()).variantAttributeValues.filter((r) => r.attributeId === attributeId).map((r) => [r.variantId, r.value]),
    )
  const addAxis = (attributeId: Id, firstVariantId: Id = newId()) =>
    run({ type: 'item.addAxis', itemId: item, attributeId, firstVariantId })
  const setShared = (attributeId: Id, value: string | null) =>
    run({ type: 'item.setAttribute', itemId: item, attributeId, value })
  const archive = (variantId: Id) => run({ type: 'archive', target: 'variant', id: variantId, archiveId: newId() })
  return { ...ctx, run, load, links, values, addAxis, setShared, archive, item, ohm, volt, color, size }
}

describe('item.setAttribute', () => {
  it('upserts a shared value and keeps the row when the value is emptied', async () => {
    const { links, setShared, size } = await withAttributes()
    await setShared(size, 'x')
    await setShared(size, 'y')
    expect(await links()).toEqual({ [size]: [null, 'y'] })
    await setShared(size, null)
    expect(await links()).toEqual({ [size]: [null, null] })
  })

  it('leaves an axis as it is', async () => {
    const { links, addAxis, setShared, ohm } = await withAttributes()
    await addAxis(ohm)
    await setShared(ohm, '4700')
    expect(await links()).toEqual({ [ohm]: [0, null] })
  })
})

describe('item.addAxis', () => {
  it('attaches an attribute that is not attached as the last axis', async () => {
    const { load, links, addAxis, ohm, volt } = await withAttributes()
    await addAxis(ohm)
    await addAxis(volt)
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [1, null] })
    expect((await load()).variants).toEqual([])
  })

  it('moves a non-empty shared value to every variant, archived ones included', async () => {
    const { run, links, values, addAxis, setShared, archive, item, ohm, volt } = await withAttributes()
    const [a, b] = [newId(), newId()]
    await addAxis(ohm)
    await run(variantsCreate(item, [[a, { [ohm]: '4700' }], [b, { [ohm]: '1000' }]]))
    await archive(b)
    await setShared(volt, '50')
    await addAxis(volt)
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [1, null] })
    expect(await values(volt)).toEqual({ [a]: '50', [b]: '50' })
    expect(await values(ohm)).toEqual({ [a]: '4700', [b]: '1000' })
  })

  it('with variants and an empty shared value, only changes the role', async () => {
    const { run, links, values, addAxis, setShared, item, ohm, volt } = await withAttributes()
    await addAxis(ohm)
    await run(variantsCreate(item, [[newId(), { [ohm]: '4700' }]]))
    await setShared(volt, null)
    await addAxis(volt)
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [1, null] })
    expect(await values(volt)).toEqual({})
  })

  it('with no variants, turns a non-empty shared value into the first variant', async () => {
    const { load, links, values, addAxis, setShared, item, ohm } = await withAttributes()
    const first = newId()
    await setShared(ohm, '10000')
    await addAxis(ohm, first)
    expect(await links()).toEqual({ [ohm]: [0, null] })
    expect((await load()).variants).toMatchObject([{ id: first, itemId: item, position: 0, description: null, archivedAt: null }])
    expect(await values(ohm)).toEqual({ [first]: '10000' })
  })

  it('with another axis and no variants, only changes the role and drops the shared value', async () => {
    const { load, links, values, addAxis, setShared, ohm, volt } = await withAttributes()
    await addAxis(ohm)
    await setShared(volt, '50')
    await addAxis(volt)
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [1, null] })
    expect((await load()).variants).toEqual([])
    expect(await values(volt)).toEqual({})
  })

  it('with no variants and an empty shared value, only changes the role', async () => {
    const { load, links, addAxis, setShared, ohm } = await withAttributes()
    await setShared(ohm, null)
    await addAxis(ohm)
    expect(await links()).toEqual({ [ohm]: [0, null] })
    expect((await load()).variants).toEqual([])
  })

  it('does nothing for an attribute that is already an axis', async () => {
    const { run, load, links, values, addAxis, item, ohm, volt } = await withAttributes()
    const a = newId()
    await addAxis(ohm)
    await addAxis(volt)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }]]))
    await addAxis(ohm)
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [1, null] })
    expect(await values(ohm)).toEqual({ [a]: '4700' })
    expect((await load()).variants.map((v) => v.id)).toEqual([a])
  })
})

describe('item.removeAxis', () => {
  it('makes the axis shared and closes the gap in the positions', async () => {
    const { run, links, addAxis, item, ohm, volt, color } = await withAttributes()
    await addAxis(ohm)
    await addAxis(volt)
    await addAxis(color)
    await run({ type: 'item.removeAxis', itemId: item, attributeId: volt })
    expect(await links()).toEqual({ [ohm]: [0, null], [color]: [1, null], [volt]: [null, null] })
  })

  it("makes a value every variant has, archived ones included, the item's value", async () => {
    const { run, links, values, addAxis, archive, item, ohm, volt } = await withAttributes()
    const [a, b] = [newId(), newId()]
    await addAxis(ohm)
    await addAxis(volt)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '1000', [volt]: '50' }]]))
    await archive(b)
    await run({ type: 'item.removeAxis', itemId: item, attributeId: volt })
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [null, '50'] })
    expect(await values(volt)).toEqual({})
    expect(await values(ohm)).toEqual({ [a]: '4700', [b]: '1000' })
  })

  it("leaves the item's value empty when the values differ, one being on an archived variant", async () => {
    const { run, links, values, addAxis, archive, item, ohm, volt } = await withAttributes()
    const [a, b] = [newId(), newId()]
    await addAxis(ohm)
    await addAxis(volt)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '1000', [volt]: '16' }]]))
    await archive(b)
    await run({ type: 'item.removeAxis', itemId: item, attributeId: volt })
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [null, null] })
    expect(await values(volt)).toEqual({})
  })

  it("leaves the item's value empty when a variant has no value", async () => {
    const { run, links, addAxis, item, ohm, volt } = await withAttributes()
    const [a, b] = [newId(), newId()]
    await addAxis(ohm)
    await addAxis(volt)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50' }], [b, { [ohm]: '1000', [volt]: '50' }]]))
    await run({ type: 'variant.setAttribute', variantId: b, attributeId: volt, value: null })
    await run({ type: 'item.removeAxis', itemId: item, attributeId: volt })
    expect(await links()).toEqual({ [ohm]: [0, null], [volt]: [null, null] })
  })

  it('compares the values exactly, case included', async () => {
    const { run, links, values, addAxis, item, ohm, size } = await withAttributes()
    const [a, b] = [newId(), newId()]
    await addAxis(ohm)
    await addAxis(size)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [size]: 'Red' }], [b, { [ohm]: '1000', [size]: 'red' }]]))
    await run({ type: 'item.removeAxis', itemId: item, attributeId: size })
    expect(await links()).toEqual({ [ohm]: [0, null], [size]: [null, null] })
    expect(await values(size)).toEqual({})
  })
})

describe('item.removeAttribute', () => {
  it('removes a shared attribute', async () => {
    const { run, links, setShared, item, size } = await withAttributes()
    await setShared(size, 'x')
    await run({ type: 'item.removeAttribute', itemId: item, attributeId: size })
    expect(await links()).toEqual({})
  })

  it('removes an axis with its values and closes the gap in the positions', async () => {
    const { run, links, values, addAxis, item, ohm, volt, color } = await withAttributes()
    const a = newId()
    await addAxis(ohm)
    await addAxis(volt)
    await addAxis(color)
    await run(variantsCreate(item, [[a, { [ohm]: '4700', [volt]: '50', [color]: 'red' }]]))
    await run({ type: 'item.removeAttribute', itemId: item, attributeId: volt })
    expect(await links()).toEqual({ [ohm]: [0, null], [color]: [1, null] })
    expect(await values(volt)).toEqual({})
    expect(await values(ohm)).toEqual({ [a]: '4700' })
    expect(await values(color)).toEqual({ [a]: 'red' })
  })
})

describe('item.reorderAxes', () => {
  it('writes the positions in the order of the list', async () => {
    const { run, links, addAxis, item, ohm, volt, color } = await withAttributes()
    await addAxis(ohm)
    await addAxis(volt)
    await addAxis(color)
    await run({ type: 'item.reorderAxes', itemId: item, attributeIds: [color, ohm, volt] })
    expect(await links()).toEqual({ [color]: [0, null], [ohm]: [1, null], [volt]: [2, null] })
    await run({ type: 'item.reorderAxes', itemId: item, attributeIds: [volt, color, ohm] })
    expect(await links()).toEqual({ [volt]: [0, null], [color]: [1, null], [ohm]: [2, null] })
  })

  it('puts the axes the list leaves out after the listed ones, and skips what is not an axis', async () => {
    const { run, links, addAxis, setShared, item, ohm, volt, color, size } = await withAttributes()
    await addAxis(ohm)
    await addAxis(volt)
    await addAxis(color)
    await setShared(size, 'x')
    await run({ type: 'item.reorderAxes', itemId: item, attributeIds: [size, color] })
    expect(await links()).toEqual({ [color]: [0, null], [ohm]: [1, null], [volt]: [2, null], [size]: [null, 'x'] })
  })
})

describe('attribute.delete', () => {
  it('removes every value of the attribute', async () => {
    const { run, load, addAxis, setShared, item, ohm, size } = await withAttributes()
    const a = newId()
    await setShared(size, 'x')
    await addAxis(ohm)
    await run(variantsCreate(item, [[a, { [ohm]: '4700' }]]))
    // An axis of an item with variants cannot go (attribute_is_axis): the variant goes first.
    await run({ type: 'archive', target: 'variant', id: a, archiveId: newId() })
    await run({ type: 'deletePermanently', target: 'variant', id: a })
    await run({ type: 'attribute.delete', id: ohm })
    await run({ type: 'attribute.delete', id: size })
    const snap = await load()
    expect(snap.attributes.map((x) => x.id)).not.toContain(ohm)
    expect(snap.itemAttributes).toEqual([])
    expect(snap.variantAttributeValues).toEqual([])
  })
})

/**
 * Device A validates a command on its copy, loaded before device B wrote: core passes it, and the database must not
 * carry it out where what it holds now breaks the rules (spec 2026-11-11 variants §4.5-4.7). The write is skipped, its
 * slice comes back as the database has it, and the revision rules reload A's copy.
 */
describe('a removal validated on a stale copy', () => {
  /** One axis, Resistance; A loads its copy; then B adds two variants. */
  async function lastAxis() {
    const ctx = await withAttributes()
    const [a, b] = [newId(), newId()]
    await ctx.addAxis(ctx.ohm)
    const stale = await ctx.load()
    await ctx.run(variantsCreate(ctx.item, [[a, { [ctx.ohm]: '1000' }], [b, { [ctx.ohm]: '10000' }]]))
    return { ...ctx, stale, a, b }
  }

  /** Validated on the stale copy (it passes), then sent. */
  async function sendStale(ctx: { run: (c: Command) => Promise<unknown>; stale: InventorySnapshot }, c: Command) {
    const command = normalizeCommand(c)
    expect(validateCommand(command, ctx.stale)).toBeNull()
    await ctx.run(command)
  }

  it('item.removeAttribute keeps the last axis of an item that has variants, and its values', async () => {
    const ctx = await lastAxis()
    await sendStale(ctx, { type: 'item.removeAttribute', itemId: ctx.item, attributeId: ctx.ohm })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null] })
    expect(await ctx.values(ctx.ohm)).toEqual({ [ctx.a]: '1000', [ctx.b]: '10000' })
  })

  it('item.removeAxis keeps the last axis of an item that has variants, and its values', async () => {
    const ctx = await lastAxis()
    await sendStale(ctx, { type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.ohm })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null] })
    expect(await ctx.values(ctx.ohm)).toEqual({ [ctx.a]: '1000', [ctx.b]: '10000' })
  })

  it('attribute.delete keeps an attribute that is an axis of an item that has variants', async () => {
    const ctx = await lastAxis()
    await sendStale(ctx, { type: 'attribute.delete', id: ctx.ohm })
    const snap = await ctx.load()
    expect(snap.attributes.map((x) => x.id)).toContain(ctx.ohm)
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null] })
    expect(await ctx.values(ctx.ohm)).toEqual({ [ctx.a]: '1000', [ctx.b]: '10000' })
  })

  it('attribute.delete keeps an axis of an item with variants even when the item has another axis', async () => {
    const ctx = await withAttributes()
    const a = newId()
    await ctx.addAxis(ctx.ohm)
    await ctx.addAxis(ctx.volt)
    const stale = await ctx.load()
    await ctx.run(variantsCreate(ctx.item, [[a, { [ctx.ohm]: '1000', [ctx.volt]: '50' }]]))
    await sendStale({ ...ctx, stale }, { type: 'attribute.delete', id: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null], [ctx.volt]: [1, null] })
    expect(await ctx.values(ctx.volt)).toEqual({ [a]: '50' })
  })

  /** Two axes, Resistance and Voltage; A loads its copy; then B adds two variants that differ only by Voltage. */
  async function twoAxes() {
    const ctx = await withAttributes()
    const [a, b] = [newId(), newId()]
    await ctx.addAxis(ctx.ohm)
    await ctx.addAxis(ctx.volt)
    const stale = await ctx.load()
    await ctx.run(
      variantsCreate(ctx.item, [[a, { [ctx.ohm]: '1000', [ctx.volt]: '16' }], [b, { [ctx.ohm]: '1000', [ctx.volt]: '50' }]]),
    )
    return { ...ctx, stale, a, b }
  }

  it('item.removeAxis does not make two variants equal', async () => {
    const ctx = await twoAxes()
    await sendStale(ctx, { type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null], [ctx.volt]: [1, null] })
    expect(await ctx.values(ctx.volt)).toEqual({ [ctx.a]: '16', [ctx.b]: '50' })
  })

  it('item.removeAttribute does not make two variants equal', async () => {
    const ctx = await twoAxes()
    await sendStale(ctx, { type: 'item.removeAttribute', itemId: ctx.item, attributeId: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null], [ctx.volt]: [1, null] })
    expect(await ctx.values(ctx.volt)).toEqual({ [ctx.a]: '16', [ctx.b]: '50' })
  })

  it('compares text values on the remaining axes without case and outer spaces', async () => {
    const ctx = await withAttributes()
    const [a, b] = [newId(), newId()]
    await ctx.addAxis(ctx.size)
    await ctx.addAxis(ctx.volt)
    const stale = await ctx.load()
    await ctx.run(
      variantsCreate(ctx.item, [[a, { [ctx.size]: 'Big', [ctx.volt]: '16' }], [b, { [ctx.size]: 'big', [ctx.volt]: '50' }]]),
    )
    await sendStale({ ...ctx, stale }, { type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.size]: [0, null], [ctx.volt]: [1, null] })
  })

  /** Two axes, Resistance and Voltage, and two variants that Resistance tells apart; A loads its copy. */
  async function twoAxesApart() {
    const ctx = await withAttributes()
    const [a, b] = [newId(), newId()]
    await ctx.addAxis(ctx.ohm)
    await ctx.addAxis(ctx.volt)
    await ctx.run(
      variantsCreate(ctx.item, [[a, { [ctx.ohm]: '1000', [ctx.volt]: '16' }], [b, { [ctx.ohm]: '4700', [ctx.volt]: '50' }]]),
    )
    const stale = await ctx.load()
    return { ...ctx, stale, a, b }
  }

  it('an axis the remaining axes still tell apart goes as usual, an empty value differing from a value', async () => {
    const ctx = await twoAxesApart()
    await ctx.run({ type: 'variant.setAttribute', variantId: ctx.a, attributeId: ctx.ohm, value: null })
    await sendStale(ctx, { type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null], [ctx.volt]: [null, null] })
    expect(await ctx.values(ctx.volt)).toEqual({})
    expect(await ctx.values(ctx.ohm)).toEqual({ [ctx.b]: '4700' })
  })

  it('empty values on the remaining axes are equal', async () => {
    const ctx = await twoAxesApart()
    await ctx.run({ type: 'variant.setAttribute', variantId: ctx.a, attributeId: ctx.ohm, value: null })
    await ctx.run({ type: 'variant.setAttribute', variantId: ctx.b, attributeId: ctx.ohm, value: null })
    await sendStale(ctx, { type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.volt })
    expect(await ctx.links()).toEqual({ [ctx.ohm]: [0, null], [ctx.volt]: [1, null] })
    expect(await ctx.values(ctx.volt)).toEqual({ [ctx.a]: '16', [ctx.b]: '50' })
  })
})

describe('variant.createMany validated on a stale copy', () => {
  it('creates no variant on an item that has no axis in the database', async () => {
    const ctx = await withAttributes()
    await ctx.addAxis(ctx.ohm)
    const stale = await ctx.load()
    // B takes the axis off (no variants yet), then A adds a variant on its copy, which still has the axis.
    await ctx.run({ type: 'item.removeAxis', itemId: ctx.item, attributeId: ctx.ohm })
    const command = normalizeCommand(variantsCreate(ctx.item, [[newId(), { [ctx.ohm]: '1000' }]]))
    expect(validateCommand(command, stale)).toBeNull()
    await ctx.run(command)
    expect((await ctx.load()).variants).toEqual([])
  })
})

describe('duplicate tag ids', () => {
  it('are stored once on create and update', async () => {
    const { storage, inv, t1, t2 } = await setup()
    const id = newId()
    await storage.apply(createItem(inv, id, { tagIds: [t1, t1] }), TEST_ACTOR)
    const tags = async () => (await storage.loadInventory(inv)).items.find((i) => i.id === id)!.tagIds
    expect(await tags()).toEqual([t1])
    await storage.apply({ type: 'item.update', id, tagIds: [t2, t2, t1, t2] }, TEST_ACTOR)
    expect([...(await tags())].sort()).toEqual([t1, t2].sort())
  })
})
