import { buildIntakeCommit, newId, resolveIntake, type Command, type DraftLine, type Intake, type Quantity } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { attributeCreate, makeStorage, sizeAxis, TEST_ACTOR, variantsCreate } from './helpers'

const q = (s: string) => s as Quantity

async function setup() {
  const storage = await makeStorage()
  const inv = newId()
  const tag = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  await storage.apply({ type: 'tag.create', id: tag, inventoryId: inv, name: 't' }, TEST_ACTOR)
  return { storage, inv, tag }
}

type Storage = Awaited<ReturnType<typeof setup>>['storage']

async function twice(storage: Storage, c: Command) {
  await storage.apply(c, TEST_ACTOR)
  await storage.apply(c, TEST_ACTOR)
}

async function plainItem(storage: Storage, inv: string) {
  const item = newId()
  await storage.apply(
    { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
    TEST_ACTOR,
  )
  return item
}

describe('replaying a command with client ids is a no-op', () => {
  it('item.create with tags and an initial receipt', async () => {
    const { storage, inv, tag } = await setup()
    const id = newId()
    await twice(storage, {
      type: 'item.create', id, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [tag],
      initialReceipt: { movementId: newId(), quantity: q('100'), totalPrice: 230, sourceUrl: null },
    })
    const snap = await storage.loadInventory(inv)
    expect(snap.items).toHaveLength(1)
    expect(snap.items[0]!.tagIds).toEqual([tag])
    expect(await storage.loadMovements(id)).toHaveLength(1)
  })

  it('item.create does not re-add tags removed after the first create', async () => {
    const { storage, inv, tag } = await setup()
    const id = newId()
    const create: Command = {
      type: 'item.create', id, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [tag], initialReceipt: null,
    }
    await storage.apply(create, TEST_ACTOR)
    await storage.apply({ type: 'item.update', id, tagIds: [] }, TEST_ACTOR)
    await storage.apply(create, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).items[0]!.tagIds).toEqual([])
  })

  it('stock.receive, use, return, transfer and set', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [v, size] = [newId(), newId()]
    for (const c of sizeAxis(inv, item, size)) await storage.apply(c, TEST_ACTOR)
    await storage.apply(variantsCreate(item, [[v, { [size]: 'S' }]]), TEST_ACTOR)
    const qty = async (variantId: string | null) => (await storage.loadInventory(inv)).stock.find((l) => l.variantId === variantId)?.quantity
    const receive = (quantity: string): Command => ({
      type: 'stock.receive', movementId: newId(), itemId: item, variantId: null, quantity: q(quantity), totalPrice: null, sourceUrl: null, note: null,
    })
    await twice(storage, receive('10'))
    expect(await qty(null)).toBe('10')
    await twice(storage, { type: 'stock.use', movementId: newId(), itemId: item, variantId: null, quantity: q('3'), note: null })
    expect(await qty(null)).toBe('7')
    await twice(storage, { type: 'stock.return', movementId: newId(), itemId: item, variantId: null, quantity: q('1'), note: null })
    expect(await qty(null)).toBe('8')
    expect(await storage.loadMovements(item)).toHaveLength(3)
    await twice(storage, {
      type: 'stock.transfer', transferId: newId(), outMovementId: newId(), inMovementId: newId(), itemId: item, fromVariantId: null, toVariantId: v, quantity: q('4'),
    })
    expect(await storage.loadMovements(item)).toHaveLength(5)
    expect(await qty(null)).toBe('4')
    expect(await qty(v)).toBe('4')
    const set: Command = { type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: q('1'), note: null }
    await storage.apply(set, TEST_ACTOR)
    expect(await qty(null)).toBe('1')
    await storage.apply(receive('5'), TEST_ACTOR)
    await storage.apply(set, TEST_ACTOR) // same id, but the delta is different now: still must not insert or throw
    expect(await qty(null)).toBe('6')
    expect((await storage.loadMovements(item)).filter((m) => m.kind === 'adjustment')).toHaveLength(1)
  })

  it('variant.createMany keeps positions and the values set since', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const size = newId()
    const [a, b] = [newId(), newId()]
    await storage.apply(attributeCreate(inv, size, 'Size'), TEST_ACTOR)
    await storage.apply({ type: 'item.addAxis', itemId: item, attributeId: size, firstVariantId: newId() }, TEST_ACTOR)
    const create = variantsCreate(item, [[a, { [size]: 'S' }], [b, { [size]: 'M' }]])
    await twice(storage, create)
    await storage.apply({ type: 'variant.setAttribute', variantId: a, attributeId: size, value: 'XS' }, TEST_ACTOR)
    await storage.apply(create, TEST_ACTOR)
    const s = await storage.loadInventory(inv)
    expect(s.variants.map((x) => [x.id, x.position])).toEqual([[a, 0], [b, 1]])
    expect(s.variantAttributeValues).toEqual(
      [
        { variantId: a, attributeId: size, value: 'XS' },
        { variantId: b, attributeId: size, value: 'M' },
      ].sort((x, y) => (x.variantId < y.variantId ? -1 : 1)),
    )
  })

  it('a retried createMany (ids already stored) changes nothing', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const size = newId()
    await storage.apply(attributeCreate(inv, size, 'Size'), TEST_ACTOR)
    await storage.apply({ type: 'item.addAxis', itemId: item, attributeId: size, firstVariantId: newId() }, TEST_ACTOR)
    const create = variantsCreate(item, [[newId(), { [size]: 'S' }], [newId(), { [size]: 'M' }]])
    await storage.apply(create, TEST_ACTOR)
    const before = await storage.loadInventory(inv)
    await storage.apply(create, TEST_ACTOR)
    expect(await storage.loadInventory(inv)).toEqual(before)
  })

  it('variant.createMany with receipts, retried after an unknown outcome, adds no second receipt (Review Focus 4)', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const size = newId()
    for (const c of sizeAxis(inv, item, size)) await storage.apply(c, TEST_ACTOR)
    const [a, b, m] = [newId(), newId(), newId()]
    const create: Command = {
      type: 'variant.createMany',
      itemId: item,
      variants: [
        { id: a, values: [{ attributeId: size, value: 'S' }], initialReceipt: { movementId: m, quantity: q('10') } },
        { id: b, values: [{ attributeId: size, value: 'M' }] },
      ],
    }
    await twice(storage, create)
    const before = await storage.loadInventory(inv)
    expect((await storage.loadMovements(item)).map((x) => [x.id, x.variantId, x.quantity])).toEqual([[m, a, '10']])
    expect(before.stock).toMatchObject([{ variantId: a, quantity: '10' }])
    // Even after the stock moved on, a late retry changes nothing.
    await storage.apply({ type: 'stock.use', movementId: newId(), itemId: item, variantId: a, quantity: q('4'), note: null }, TEST_ACTOR)
    await storage.apply(create, TEST_ACTOR)
    expect((await storage.loadInventory(inv)).stock).toMatchObject([{ variantId: a, quantity: '6' }])
    expect(await storage.loadMovements(item)).toHaveLength(2)
  })

  it('variant.setValues', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const size = newId()
    for (const c of sizeAxis(inv, item, size)) await storage.apply(c, TEST_ACTOR)
    const [a, b] = [newId(), newId()]
    await storage.apply(variantsCreate(item, [[a, { [size]: 'S' }], [b, { [size]: 'M' }]]), TEST_ACTOR)
    const swap: Command = {
      type: 'variant.setValues',
      itemId: item,
      rows: [
        { variantId: a, values: [{ attributeId: size, value: 'M' }] },
        { variantId: b, values: [{ attributeId: size, value: 'S' }] },
      ],
    }
    await storage.apply(swap, TEST_ACTOR)
    const once = await storage.loadInventory(inv)
    await storage.apply(swap, TEST_ACTOR)
    expect(await storage.loadInventory(inv)).toEqual(once)
    expect(once.variantAttributeValues.find((r) => r.variantId === a)?.value).toBe('M')
  })

  it('photo.replace', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [size, v, old, next] = [newId(), newId(), newId(), newId()]
    for (const c of sizeAxis(inv, item, size)) await storage.apply(c, TEST_ACTOR)
    await storage.apply(variantsCreate(item, [[v, { [size]: 'S' }]]), TEST_ACTOR)
    await storage.apply({ type: 'photo.add', id: old, itemId: item, variantId: v, provider: 'imgbb', fileId: old, url: `https://x/${old}` }, TEST_ACTOR)
    await twice(storage, { type: 'photo.replace', variantId: v, id: next, itemId: item, replaces: old, provider: 'imgbb', fileId: next, url: `https://x/${next}` })
    expect((await storage.loadInventory(inv)).photos.map((p) => [p.id, p.variantId, p.position])).toEqual([[next, v, 0]])
  })

  it('item.addAxis creates the first variant once', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const ohm = newId()
    const first = newId()
    await storage.apply(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }), TEST_ACTOR)
    await storage.apply({ type: 'item.setAttribute', itemId: item, attributeId: ohm, value: '10000' }, TEST_ACTOR)
    await twice(storage, { type: 'item.addAxis', itemId: item, attributeId: ohm, firstVariantId: first })
    const s = await storage.loadInventory(inv)
    expect(s.variants.map((v) => v.id)).toEqual([first])
    expect(s.variantAttributeValues).toEqual([{ variantId: first, attributeId: ohm, value: '10000' }])
    expect(s.itemAttributes).toEqual([{ itemId: item, attributeId: ohm, value: null, axisPosition: 0 }])
  })

  it('photo.add keeps the first position', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [p1, p2] = [newId(), newId()]
    const add = (id: string): Command => ({ type: 'photo.add', id, itemId: item, variantId: null, provider: 'imgbb', fileId: id, url: `https://x/${id}` })
    await storage.apply(add(p1), TEST_ACTOR)
    await storage.apply(add(p2), TEST_ACTOR)
    await storage.apply(add(p1), TEST_ACTOR)
    expect((await storage.loadInventory(inv)).photos.map((p) => [p.id, p.position])).toEqual([[p1, 0], [p2, 1]])
  })

  it('inventory, folder, tag, attribute and unit creates', async () => {
    const { storage, inv } = await setup()
    await twice(storage, { type: 'inventory.create', id: newId(), name: 'B', description: null, currency: 'USD' })
    expect((await storage.listInventories()).inventories).toHaveLength(2)
    await twice(storage, { type: 'folder.create', id: newId(), inventoryId: inv, parentId: null, name: 'F', description: null })
    await twice(storage, { type: 'tag.create', id: newId(), inventoryId: inv, name: 'again' })
    await twice(storage, attributeCreate(inv, newId(), 'Color'))
    await twice(storage, { type: 'unit.create', id: newId(), inventoryId: inv, name: 'Roll', symbol: 'rl', prefixPowers: [] })
    const s = await storage.loadInventory(inv)
    expect([s.folders.length, s.tags.length, s.attributes.length, s.units.length]).toEqual([1, 2, 1, 1])
  })

  it('intake.commit: new item, new variant, replaced photo and receipts, the intake row missing (deleted elsewhere)', async () => {
    const { storage, inv } = await setup()
    const item = await plainItem(storage, inv)
    const [size, v, old, made, intakeId] = [newId(), newId(), newId(), newId(), newId()]
    for (const c of sizeAxis(inv, item, size)) await storage.apply(c, TEST_ACTOR)
    await storage.apply(variantsCreate(item, [[v, { [size]: 'S' }]]), TEST_ACTOR)
    await storage.apply({ type: 'photo.add', id: old, itemId: item, variantId: v, provider: 'imgbb', fileId: old, url: `https://x/${old}` }, TEST_ACTOR)
    const line = (itemId: string, value: string | null, extra: Partial<DraftLine> = {}): DraftLine => ({
      id: newId(), itemId, axisValues: value === null ? [] : [{ attributeId: size, value }], quantity: q('3'), totalPrice: 90,
      sourceUrl: null, photo: null, ids: { movementId: newId(), variantId: newId(), photoId: newId() }, ...extra,
    })
    const photo = { provider: 'imgbb', fileId: 'n', url: 'https://x/n', replace: true }
    const intake: Intake = {
      id: intakeId, inventoryId: inv, status: 'draft',
      header: { shop: null, orderNumber: null, purchasedOn: '2026-11-13', note: null },
      draft: {
        newItems: [{ id: made, name: 'Fuse', folderId: null, unitKey: 'pcs', attributes: [] }],
        lines: [line(item, 'S', { photo }), line(item, 'M'), line(made, null)],
      },
      lines: null, draftRev: newId(), createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', committedAt: null,
    }
    const { snapshot, rev } = await storage.loadInventoryWithRev(inv)
    await twice(storage, buildIntakeCommit(intake, resolveIntake(intake.draft!, snapshot), snapshot, rev))
    const s = await storage.loadInventory(inv)
    expect(s.items.map((i) => i.name).sort()).toEqual(['Fuse', 'R'])
    expect(s.variants).toHaveLength(2)
    expect(s.photos.map((p) => [p.variantId, p.fileId, p.position])).toEqual([[v, 'n', 0]])
    expect((await storage.loadAllMovements(inv)).map((m) => m.intakeId)).toEqual([intakeId, intakeId, intakeId])
    expect((await storage.listIntakes(inv)).intakes.map((i) => [i.id, i.status, i.lines?.length])).toEqual([[intakeId, 'committed', 3]])
  })
})
