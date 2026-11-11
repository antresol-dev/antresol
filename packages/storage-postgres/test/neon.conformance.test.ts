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
    expect(() => assertTestDatabase('postgres://u:p@h/graymatter_test?sslmode=require')).not.toThrow()
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

      it('reports the freshly reset database as empty', async () => {
        expect(await inspectSchema(exec)).toEqual({ state: 'empty' })
      })

      it('runs the stock scenario', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = newId()
        const item = newId()
        const rev0 = (await storage.listInventories()).rev
        await storage.apply({ type: 'inventory.create', id: inv, name: `inv-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
        const rev1 = (await storage.listInventories()).rev
        expect(rev1).not.toBe(rev0)
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
        const rev2 = (await storage.listInventories()).rev
        expect(rev2).not.toBe(rev1)
        const { stock } = await storage.loadInventory(inv)
        expect(stock.find((l) => l.variantId === null)!.quantity).toBe('37')
        expect((await storage.listInventories()).rev).toBe(rev2)
        expect((await inspectSchema(exec)).state).toBe('current')
      })

      it('batch returns the rows of each statement in order', async () => {
        const result = await exec.batch([
          { text: 'create temp table gm_probe (x int) on commit drop', params: [] },
          { text: 'insert into gm_probe values (1), (2)', params: [] },
          { text: 'update gm_probe set x = x + 1 where x = 2', params: [] },
          { text: 'select x from gm_probe order by x', params: [] },
        ])
        expect(result.length).toBe(4)
        expect(result[1]).toEqual([])
        expect(result[2]).toEqual([])
        expect(result[3]).toEqual([{ x: 1 }, { x: 3 }])
      })

      it('apply returns rows and revisions', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = newId()
        const item = newId()
        const photo = newId()
        const before = (await storage.listInventories()).rev
        const created = await storage.apply(
          { type: 'inventory.create', id: inv, name: `rows-${name}`, description: null, currency: 'USD' },
          TEST_ACTOR,
        )
        expect(created.prevRev).toBe(before)
        expect(created.patch).toMatchObject({ inventoryId: inv, itemIds: [], inventory: { id: inv } })
        await storage.apply(
          { type: 'item.create', id: item, inventoryId: inv, folderId: null, name: 'R', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null },
          TEST_ACTOR,
        )
        await storage.apply(
          { type: 'photo.add', id: photo, itemId: item, variantId: null, provider: 'imgbb', fileId: 'f', url: 'https://i.example/f' },
          TEST_ACTOR,
        )
        // Resolved before the delete, through a transaction-local setting read by the later statements.
        const removed = await storage.apply({ type: 'photo.remove', id: photo }, TEST_ACTOR)
        expect(removed.patch).toMatchObject({ inventoryId: inv, itemIds: [item], items: [{ id: item }], photos: [] })
        expect(removed.rev).toBe((await storage.listInventories()).rev)
        const received = await storage.apply(
          { type: 'stock.receive', movementId: newId(), itemId: item, variantId: null, quantity: '4' as Quantity, totalPrice: 120, sourceUrl: null, note: null },
          TEST_ACTOR,
        )
        expect(received.prevRev).toBe(removed.rev)
        expect(received.patch!.stock).toEqual((await storage.loadInventory(inv)).stock)
      })

      it('concurrent applies are serialized on the revision row', async () => {
        const other = make()
        try {
          const { storage: a } = await openPostgresStorage(exec)
          const { storage: b } = await openPostgresStorage(other)
          const inv = newId()
          await a.apply({ type: 'inventory.create', id: inv, name: `race-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
          const folder = (id: string) =>
            ({ type: 'folder.create', id, inventoryId: inv, parentId: null, name: id, description: null }) as const
          for (let round = 0; round < 3; round++) {
            const [ra, rb] = await Promise.all([a.apply(folder(newId()), TEST_ACTOR), b.apply(folder(newId()), TEST_ACTOR)])
            // Whichever committed second read, under the lock, exactly the revision the first one wrote.
            const revs = JSON.stringify([ra.prevRev, ra.rev, rb.prevRev, rb.rev])
            expect(ra.prevRev === rb.rev || rb.prevRev === ra.rev, revs).toBe(true)
          }
        } finally {
          await other.close()
        }
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
