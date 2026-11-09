import { newId, type Quantity } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertTestDatabase, createNeonHttpExecutor, createNeonWsExecutor, type PgExecutor } from '../src'
import { openPostgresStorage } from '../src/storage'
import { TEST_ACTOR } from './helpers'

describe('assertTestDatabase', () => {
  it('rejects a database whose name does not end with _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter')).toThrow()
  })
  it('accepts a _test database and ignores the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter_test?sslmode=require')).not.toThrow()
  })
  it('rejects a _test suffix that only appears in the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter?x=_test')).toThrow()
  })
})

// tests run in Node; src/ has no Node types on purpose
declare const process: { env: Record<string, string | undefined> }

const url = process.env.GM_NEON_TEST_URL

describe.skipIf(!url)('Neon conformance', () => {
  beforeAll(async () => {
    assertTestDatabase(url!)
    const exec = createNeonWsExecutor(url!)
    try {
      await exec.batch([
        { text: 'DROP SCHEMA public CASCADE', params: [] },
        { text: 'CREATE SCHEMA public', params: [] },
      ])
    } finally {
      await exec.close()
    }
  })

  const drivers: [string, () => PgExecutor][] = [
    ['websocket', () => createNeonWsExecutor(url!)],
    ['http', () => createNeonHttpExecutor(url!)],
  ]

  for (const [name, make] of drivers) {
    describe(name, () => {
      let exec: PgExecutor
      beforeAll(() => {
        exec = make()
      })
      afterAll(() => exec.close())

      it('runs the stock scenario', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = newId()
        const item = newId()
        await storage.apply({ type: 'inventory.create', id: inv, name: `inv-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
        await storage.apply(
          {
            type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [],
            initialReceipt: { movementId: newId(), quantity: '100' as Quantity, totalPrice: 230, sourceUrl: null },
          },
          TEST_ACTOR,
        )
        await storage.apply(
          { type: 'stock.set', movementId: newId(), itemId: item, variantId: null, target: '37' as Quantity, note: null },
          TEST_ACTOR,
        )
        const { stock } = await storage.loadInventory(inv)
        expect(stock.find((l) => l.variantId === null)!.quantity).toBe('37')
      })
    })
  }
})
