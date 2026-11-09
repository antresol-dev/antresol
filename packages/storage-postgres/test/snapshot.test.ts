import { newId } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor, TEST_ACTOR } from './helpers'

describe('snapshot stock aggregate', () => {
  it('sums per bucket and prices only receipts with a total', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const inv = newId()
    const item = newId()
    await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    await exec.batch([
      sql`insert into items (id, inventory_id, name, created_by, updated_by) values (${item}, ${inv}, 'x', 'T', 'T')`,
      ...(
        [
          ['receipt', '2', 300],
          ['receipt', '1.5', null],
          ['receipt', '4', 800],
          ['usage', '-1', null],
        ] as const
      ).map(
        ([kind, q, price]) =>
          sql`insert into movements (id, inventory_id, item_id, kind, quantity, total_price, created_by)
              values (${newId()}, ${inv}, ${item}, ${kind}, ${q}, ${price}, 'T')`,
      ),
    ])
    const { stock } = await storage.loadInventory(inv)
    expect(stock).toHaveLength(1)
    expect(stock[0]).toMatchObject({
      itemId: item,
      variantId: null,
      quantity: '6.5',
      pricedQuantity: '6',
      pricedTotal: 1100,
      lastPriced: { totalPrice: 800, quantity: '4' },
    })
    const movements = await storage.loadMovements(item)
    expect(movements.map((m) => m.kind)).toEqual(['usage', 'receipt', 'receipt', 'receipt'])
    expect(movements[0]!.seq).toBeGreaterThan(movements[1]!.seq)
  })
})
