import { newId, type Command } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { sql } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { attributeCreate, itemCreate, makeExecutor, sorted, TEST_ACTOR } from './helpers'

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

describe('loadInventoryWithRev', () => {
  it('returns the revision read with the snapshot', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const inv = newId()
    await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    const first = await storage.loadInventoryWithRev(inv)
    expect(first.snapshot).toEqual(await storage.loadInventory(inv))
    expect(first.rev).toBe((await storage.listInventories()).rev)
    await storage.apply({ type: 'inventory.update', id: inv, name: 'B' }, TEST_ACTOR)
    const second = await storage.loadInventoryWithRev(inv)
    expect(second.rev).toBe((await storage.listInventories()).rev)
    expect(second.rev).not.toBe(first.rev)
  })
})

describe('schema of variants and attributes', () => {
  it('variants have no name, attributes take the number kind and no other', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const inv = newId()
    await storage.apply({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' }, TEST_ACTOR)
    const columns = await exec.query<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'variants'`,
    )
    expect(columns.map((c) => c.column_name)).not.toContain('name')
    const insert = (kind: string) =>
      exec.batch([
        sql`insert into attributes (id, inventory_id, name, kind, created_by, updated_by)
            values (${newId()}, ${inv}, 'x', ${kind}, 'T', 'T')`,
      ])
    await expect(insert('number')).resolves.toBeDefined()
    await expect(insert('float')).rejects.toThrow(/attributes_kind_check/)
  })

  it('reads the unit, the prefix setting and the axis positions', async () => {
    const exec = await makeExecutor()
    const { storage } = await openPostgresStorage(exec)
    const run = (c: Command) => storage.apply(c, TEST_ACTOR)
    const [inv, item, ohm, size] = [newId(), newId(), newId(), newId()]
    await run({ type: 'inventory.create', id: inv, name: 'A', description: null, currency: 'USD' })
    await run(itemCreate(inv, item))
    await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
    await run(attributeCreate(inv, size, 'Size'))
    await run({ type: 'item.addAxis', itemId: item, attributeId: ohm, firstVariantId: newId() })
    await run({ type: 'item.setAttribute', itemId: item, attributeId: size, value: 'x' })
    const s = await storage.loadInventory(inv)
    expect(sorted(s.attributes, (a) => a.name)).toMatchObject([
      { id: ohm, kind: 'number', unit: 'Ω', siPrefixes: true },
      { id: size, kind: 'text', unit: '', siPrefixes: false },
    ])
    expect(sorted(s.itemAttributes, (r) => r.attributeId)).toEqual(
      sorted(
        [
          { itemId: item, attributeId: ohm, value: null, axisPosition: 0 },
          { itemId: item, attributeId: size, value: 'x', axisPosition: null },
        ],
        (r) => r.attributeId,
      ),
    )
  })
})
