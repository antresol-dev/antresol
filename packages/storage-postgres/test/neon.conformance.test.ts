import { newId, type Quantity } from '@graymatter/core'
import { neonConfig } from '@neondatabase/serverless'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertTestDatabase, createNeonHttpExecutor, createNeonWsExecutor, inspectSchema, type PgExecutor } from '../src'
import { openPostgresStorage } from '../src/storage'
import { TEST_ACTOR } from './helpers'

describe('assertTestDatabase', () => {
  it('rejects a database whose name does not end with _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter')).toThrow(/must end with "_test"/)
  })
  it('accepts a _test database and ignores the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter_test?sslmode=require')).not.toThrow(/must end with "_test"/)
  })
  it('rejects a _test suffix that only appears in the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter?x=_test')).toThrow(/must end with "_test"/)
  })
})

// tests run in Node; src/ has no Node types on purpose
declare const process: { env: Record<string, string | undefined> }

const url = process.env.GM_NEON_TEST_URL

describe.skipIf(!url)('Neon conformance', () => {
  // Wiped before each driver's scenario so every driver runs the migrator itself.
  async function resetSchema() {
    assertTestDatabase(url!)
    const exec = createNeonWsExecutor(url!)
    try {
      await exec.batch([{ text: 'DROP SCHEMA public CASCADE', params: [] }])
      await exec.batch([{ text: 'CREATE SCHEMA public', params: [] }])
    } finally {
      await exec.close()
    }
  }

  const drivers: [string, () => PgExecutor][] = [
    ['websocket', () => createNeonWsExecutor(url!)],
    ['http', () => createNeonHttpExecutor(url!)],
  ]

  for (const [name, make] of drivers) {
    describe(name, () => {
      let exec: PgExecutor
      beforeAll(async () => {
        await resetSchema()
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
        expect((await inspectSchema(exec)).state).toBe('current')
      })

      it.skipIf(name !== 'http')('loads an inventory snapshot in one fetch', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = newId()
        await storage.apply({ type: 'inventory.create', id: inv, name: `snap-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
        const previous = neonConfig.fetchFunction
        let calls = 0
        neonConfig.fetchFunction = (...args: Parameters<typeof fetch>) => {
          calls++
          return fetch(...args)
        }
        try {
          await storage.loadInventory(inv)
        } finally {
          neonConfig.fetchFunction = previous
        }
        expect(calls).toBe(1)
      })
    })
  }
})
