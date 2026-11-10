import { newId, type InventoryStorage, type Quantity } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { makeStorage, TEST_ACTOR } from './helpers'

async function setup(unitKey = 'pcs') {
  const storage = await makeStorage()
  const inv = newId()
  const item = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  await storage.apply(
    { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey, tagIds: [], initialReceipt: null },
    TEST_ACTOR,
  )
  return { storage, inv, item }
}

const q = (s: string) => s as Quantity

async function bucket(storage: InventoryStorage, inv: string, variantId: string | null) {
  const { stock } = await storage.loadInventory(inv)
  return stock.find((l) => l.variantId === variantId)
}

const receive = (itemId: string, quantity: string, totalPrice: number | null, variantId: string | null = null) => ({
  type: 'stock.receive' as const,
  movementId: newId(),
  itemId,
  variantId,
  quantity: q(quantity),
  totalPrice,
  sourceUrl: null,
  note: null,
})

describe('stock journal', () => {
  it('runs the full pieces scenario', async () => {
    const { storage, inv, item } = await setup()
    const v1 = newId()
    const v2 = newId()
    await storage.apply({ type: 'variant.createMany', itemId: item, variants: [{ id: v1, name: 'v1' }, { id: v2, name: 'v2' }] }, TEST_ACTOR)

    await storage.apply(receive(item, '100', 230), TEST_ACTOR)
    await storage.apply({ type: 'stock.use', movementId: newId(), itemId: item, variantId: null, quantity: q('4'), note: 'VCO' }, TEST_ACTOR)
    expect((await bucket(storage, inv, null))!.quantity).toBe('96')
    const m = await storage.loadMovements(item)
    expect(m[0]).toMatchObject({ kind: 'usage', quantity: '-4', note: 'VCO' })
    expect(m[1]).toMatchObject({ kind: 'receipt', quantity: '100', totalPrice: 230 })

    await storage.apply({ type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: q('37'), note: null }, TEST_ACTOR)
    expect((await storage.loadMovements(item))[0]).toMatchObject({ kind: 'adjustment', quantity: '-59' })
    expect((await bucket(storage, inv, null))!.quantity).toBe('37')

    const transferId = newId()
    await storage.apply(
      { type: 'stock.transfer', transferId, outMovementId: newId(), inMovementId: newId(), itemId: item, fromVariantId: null, toVariantId: v1, quantity: q('30') },
      TEST_ACTOR,
    )
    expect((await bucket(storage, inv, null))!.quantity).toBe('7')
    expect((await bucket(storage, inv, v1))!.quantity).toBe('30')
    const t = (await storage.loadMovements(item)).filter((x) => x.kind === 'transfer')
    expect(t).toHaveLength(2)
    expect(t[0]!.transferId).toBe(transferId)
    expect(t[1]!.transferId).toBe(transferId)

    await storage.apply({ type: 'stock.return', movementId: newId(), itemId: item, variantId: v1, quantity: q('2'), note: null }, TEST_ACTOR)
    expect((await bucket(storage, inv, v1))!.quantity).toBe('32')

    await storage.apply({ type: 'stock.set', movementId: newId(), itemId: item, variantId: v2, target: q('5'), note: null }, TEST_ACTOR)
    expect((await storage.loadMovements(item))[0]).toMatchObject({ kind: 'adjustment', quantity: '5', variantId: v2 })
  })

  it('lists movements newest first by number, not as text, past seq 9', async () => {
    const { storage, item } = await setup()
    for (let i = 1; i <= 11; i++) await storage.apply(receive(item, String(i), null), TEST_ACTOR)
    const m = await storage.loadMovements(item)
    expect(m.map((x) => x.quantity)).toEqual(['11', '10', '9', '8', '7', '6', '5', '4', '3', '2', '1'])
    expect(m.every((x, i) => i === 0 || x.seq < m[i - 1]!.seq)).toBe(true)
  })

  it('loadAllMovements returns every movement of an inventory, oldest first, and no other inventory\'s', async () => {
    const { storage, inv, item } = await setup()
    const otherInv = newId()
    const otherItem = newId()
    await storage.apply({ type: 'inventory.create', id: otherInv, name: 'B', description: null, currency: 'USD' }, TEST_ACTOR)
    await storage.apply(
      { type: 'item.create', id: otherItem, inventoryId: otherInv, folderId: null, name: 'O', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
      TEST_ACTOR,
    )
    const second = newId()
    await storage.apply(
      { type: 'item.create', id: second, inventoryId: inv, folderId: null, name: 'S', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
      TEST_ACTOR,
    )
    for (let i = 1; i <= 11; i++) await storage.apply(receive(i % 2 ? item : second, String(i), null), TEST_ACTOR)
    await storage.apply(receive(otherItem, '99', null), TEST_ACTOR)
    const all = await storage.loadAllMovements(inv)
    expect(all.map((x) => x.quantity)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
    expect(new Set(all.map((x) => x.itemId))).toEqual(new Set([item, second]))
    expect((await storage.loadAllMovements(otherInv)).map((x) => x.quantity)).toEqual(['99'])
    expect(await storage.loadAllMovements(newId())).toEqual([])
  })

  it('exportInventory returns the snapshot and the movements together, and not_found for an unknown inventory', async () => {
    const { storage, inv, item } = await setup()
    await storage.apply(receive(item, '1', null), TEST_ACTOR)
    await storage.apply(receive(item, '2', null), TEST_ACTOR)
    const out = await storage.exportInventory(inv)
    expect(out.snapshot).toEqual(await storage.loadInventory(inv))
    expect(out.movements).toEqual(await storage.loadAllMovements(inv))
    expect(out.movements.map((x) => x.quantity)).toEqual(['1', '2'])
    await expect(storage.exportInventory(newId())).rejects.toMatchObject({ code: 'not_found' })
  })

  it('stock.set to the current quantity adds no movement', async () => {
    const { storage, item } = await setup()
    await storage.apply(receive(item, '10', null), TEST_ACTOR)
    await storage.apply({ type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: q('10'), note: null }, TEST_ACTOR)
    expect(await storage.loadMovements(item)).toHaveLength(1)
  })

  it('adds fractions exactly', async () => {
    const { storage, inv, item } = await setup('m')
    await storage.apply(receive(item, '0.1', null), TEST_ACTOR)
    await storage.apply(receive(item, '0.2', null), TEST_ACTOR)
    expect((await bucket(storage, inv, null))!.quantity).toBe('0.3')
  })

  it('priced aggregates ignore receipts without a price and track the latest priced one', async () => {
    const { storage, inv, item } = await setup()
    await storage.apply(receive(item, '2', 300), TEST_ACTOR)
    await storage.apply(receive(item, '4', 800), TEST_ACTOR)
    await storage.apply(receive(item, '5', null), TEST_ACTOR)
    const line = (await bucket(storage, inv, null))!
    expect(line.quantity).toBe('11')
    expect(line.pricedQuantity).toBe('6')
    expect(line.pricedTotal).toBe(1100)
    expect(line.lastPriced).toMatchObject({ totalPrice: 800, quantity: '4' })
  })
})

describe('un-normalized input', () => {
  it('canonicalizes a comma quantity instead of throwing', async () => {
    const { storage, inv, item } = await setup()
    await storage.apply(receive(item, '1,5', null), TEST_ACTOR)
    expect((await bucket(storage, inv, null))!.quantity).toBe('1.5')
  })
})
