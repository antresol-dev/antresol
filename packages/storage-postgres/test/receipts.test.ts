import { newId, type Command, type Id, type InventoryStorage } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { itemCreate, makeStorage, sizeAxis, TEST_ACTOR, variantsCreate } from './helpers'

const LOT = '1005001234567890'

async function setup() {
  const storage = await makeStorage()
  const inv = newId()
  await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
  return { storage, inv }
}

const create = (inventoryId: Id, id: Id, sourceUrl: string | null, quantity = '10'): Command => ({
  type: 'item.create',
  id,
  inventoryId,
  folderId: null,
  name: `Item ${id.slice(0, 4)}`,
  description: null,
  unitKey: 'pcs',
  tagIds: [],
  initialReceipt: { movementId: newId(), quantity, totalPrice: null, sourceUrl },
})

const receive = (itemId: Id, quantity: string, sourceUrl: string | null, variantId: Id | null = null): Command => ({
  type: 'stock.receive',
  movementId: newId(),
  itemId,
  variantId,
  quantity,
  totalPrice: null,
  sourceUrl,
  note: null,
})

async function apply(storage: InventoryStorage, ...commands: Command[]) {
  for (const c of commands) await storage.apply(c, TEST_ACTOR)
}

describe('findReceiptsBySource', () => {
  it('finds the receipts whose link holds the lot id, newest first, with item, variant and quantity', async () => {
    const { storage, inv } = await setup()
    const a = newId()
    const b = newId()
    const v = newId()
    const size = newId()
    await apply(storage, create(inv, a, `https://www.aliexpress.com/item/${LOT}.html?spm=x`, '100'))
    await apply(storage, itemCreate(inv, b), ...sizeAxis(inv, b, size))
    await apply(storage, variantsCreate(b, [[v, { [size]: 'S' }]]))
    await apply(storage, receive(b, '7', `https://m.aliexpress.us/item/${LOT}.html`, v))
    // Not this lot: a longer id, another shop, no link, a usage.
    await apply(storage, receive(a, '3', `https://www.aliexpress.com/item/${LOT}1.html`))
    await apply(storage, receive(a, '4', 'https://shop.example/other'))
    await apply(storage, receive(a, '5', null))
    await apply(storage, { type: 'stock.use', movementId: newId(), itemId: a, variantId: null, quantity: '1', note: null })

    const found = await storage.findReceiptsBySource(inv, LOT)
    expect(found.map(({ itemId, variantId, quantity }) => ({ itemId, variantId, quantity }))).toEqual([
      { itemId: b, variantId: v, quantity: '7' },
      { itemId: a, variantId: null, quantity: '100' },
    ])
    expect(new Date(found[0]!.at).getTime()).toBeGreaterThanOrEqual(new Date(found[1]!.at).getTime())
  })

  it('matches an address key without case, parameters or www, and only on whole parts of the address', async () => {
    const { storage, inv } = await setup()
    const a = newId()
    await apply(storage, create(inv, a, 'https://www.LCSC.com/product-detail/C7593.html?s_z=n_tl072'))
    await apply(storage, receive(a, '2', 'https://lcsc.com/product-detail/C75931.html'))
    const found = await storage.findReceiptsBySource(inv, 'lcsc.com/product-detail/c7593.html')
    expect(found.map((r) => r.quantity)).toEqual(['10'])
  })

  it('keeps to the inventory and treats the key as plain text', async () => {
    const { storage, inv } = await setup()
    const other = newId()
    await storage.apply({ type: 'inventory.create', id: other, name: 'B', description: null, currency: 'USD' }, TEST_ACTOR)
    await apply(storage, create(other, newId(), `https://www.aliexpress.com/item/${LOT}.html`))
    await apply(storage, create(inv, newId(), 'https://shop.example/axb'))
    expect(await storage.findReceiptsBySource(inv, LOT)).toEqual([])
    expect(await storage.findReceiptsBySource(inv, 'shop.example/a_b')).toEqual([])
    expect(await storage.findReceiptsBySource(inv, 'shop.example/a%')).toEqual([])
    expect(await storage.findReceiptsBySource(inv, '')).toEqual([])
    expect((await storage.findReceiptsBySource(other, LOT)).map((r) => r.quantity)).toEqual(['10'])
  })
})
