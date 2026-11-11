import { newId, normalizeCommand, patchSnapshot, type Command, type InventorySnapshot, type Quantity } from '@graymatter/core'
import { neonConfig } from '@neondatabase/serverless'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertTestDatabase, createNeonHttpExecutor, createNeonWsExecutor, inspectSchema, type PgExecutor } from '../src'
import { toStatements } from '../src/commands'
import { ensureSchema, LOCK_REV, REV_BUMP } from '../src/migrator'
import { sql } from '../src/sql'
import { uuidV5 } from '../src/restore'
import { openPostgresStorage } from '../src/storage'
import { attributeCreate, itemCreate, normSnapshot, TEST_ACTOR, variantsCreate } from './helpers'
import { renamed, seedRich } from './restore-fixtures'

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

      it('runs the axis scenario: patched copy equals a reload', async () => {
        const { storage } = await openPostgresStorage(exec)
        const run = (c: Command) => storage.apply(c, TEST_ACTOR)
        const [inv, resistor, capacitor, ohm, cap, volt] = [newId(), newId(), newId(), newId(), newId(), newId()]
        const [first, a, c1, c2] = [newId(), newId(), newId(), newId()]
        await run({ type: 'inventory.create', id: inv, name: `axes-${name}`, description: null, currency: 'USD' })
        let copy: InventorySnapshot = await storage.loadInventory(inv)
        const step = async (c: Command) => {
          const r = await run(c)
          expect(r.patch, c.type).not.toBeNull()
          copy = patchSnapshot(copy, r.patch!)
        }
        await step(itemCreate(inv, resistor, 'Resistor'))
        await step(itemCreate(inv, capacitor, 'Capacitor'))
        await step(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
        await step(attributeCreate(inv, cap, 'Capacitance', 'number', { unit: 'F', siPrefixes: true }))
        await step(attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V' }))
        // No axes and no variants: the shared value becomes the first variant.
        await step({ type: 'item.setAttribute', itemId: resistor, attributeId: ohm, value: '10000' })
        await step({ type: 'item.addAxis', itemId: resistor, attributeId: ohm, firstVariantId: first })
        await step(variantsCreate(resistor, [[a, { [ohm]: '4700' }]]))
        // Another axis and no variants: only the role changes, the shared value goes and no variant is made.
        await step({ type: 'item.addAxis', itemId: capacitor, attributeId: cap, firstVariantId: newId() })
        await step({ type: 'item.setAttribute', itemId: capacitor, attributeId: volt, value: '50' })
        await step({ type: 'item.addAxis', itemId: capacitor, attributeId: volt, firstVariantId: newId() })
        expect(copy.variants.filter((v) => v.itemId === capacitor)).toEqual([])
        await step(variantsCreate(capacitor, [[c1, { [cap]: '0.0000001', [volt]: '50' }], [c2, { [cap]: '0.00001', [volt]: '50' }]]))
        await step({ type: 'item.reorderAxes', itemId: capacitor, attributeIds: [volt, cap] })
        await step({ type: 'variant.setAttribute', variantId: c2, attributeId: volt, value: null })
        await step({ type: 'variant.setAttribute', variantId: c2, attributeId: volt, value: '50' })
        await step({ type: 'variant.update', id: c2, description: '105 °C' })
        // Every variant has 50 V: it becomes the item's value.
        await step({ type: 'item.removeAxis', itemId: capacitor, attributeId: volt })
        await step({ type: 'attribute.update', id: ohm, unit: 'kΩ', siPrefixes: false })
        await step({ type: 'attribute.update', id: ohm, pinned: true })
        await step({ type: 'attribute.update', id: cap, pinned: true })
        // A third pin, sent unvalidated as from a copy that is behind: skipped.
        await step({ type: 'attribute.update', id: volt, pinned: true })

        const fresh = await storage.loadInventory(inv)
        expect(fresh.attributes.filter((x) => x.pinned).map((x) => x.id).sort()).toEqual([ohm, cap].sort())
        expect(normSnapshot(copy)).toEqual(normSnapshot(fresh))
        expect(fresh.variants.filter((v) => v.itemId === resistor).map((v) => v.id).sort()).toEqual([first, a].sort())
        expect(fresh.variants.filter((v) => v.itemId === capacitor).map((v) => v.id).sort()).toEqual([c1, c2].sort())
        expect(fresh.variantAttributeValues.filter((r) => r.variantId === first)).toEqual([
          { variantId: first, attributeId: ohm, value: '10000' },
        ])
        const links = Object.fromEntries(
          fresh.itemAttributes.filter((r) => r.itemId === capacitor).map((r) => [r.attributeId, [r.axisPosition, r.value]]),
        )
        expect(links).toEqual({ [cap]: [0, null], [volt]: [null, '50'] })
        expect(fresh.attributes.find((x) => x.id === ohm)).toMatchObject({ kind: 'number', unit: 'kΩ', siPrefixes: false })
        expect(fresh.attributes.find((x) => x.id === cap)).toMatchObject({ kind: 'number', unit: 'F', siPrefixes: true })
      })

      it('skips an axis removal the database state forbids, whatever copy validated it', async () => {
        const { storage } = await openPostgresStorage(exec)
        const run = (c: Command) => storage.apply(c, TEST_ACTOR)
        const [inv, item, ohm, size, a, b] = [newId(), newId(), newId(), newId(), newId(), newId()]
        await run({ type: 'inventory.create', id: inv, name: `stale-${name}`, description: null, currency: 'USD' })
        await run(itemCreate(inv, item, 'Resistor'))
        await run(attributeCreate(inv, ohm, 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }))
        await run(attributeCreate(inv, size, 'Size'))
        await run({ type: 'item.addAxis', itemId: item, attributeId: size, firstVariantId: newId() })
        await run({ type: 'item.addAxis', itemId: item, attributeId: ohm, firstVariantId: newId() })
        await run(variantsCreate(item, [[a, { [size]: 'Big', [ohm]: '1000' }], [b, { [size]: 'big', [ohm]: '4700' }]]))
        // Sent unvalidated, as from a copy that is behind. Size alone leaves "Big" and "big" equal: skipped.
        await run({ type: 'item.removeAxis', itemId: item, attributeId: ohm })
        // Resistance alone tells them apart: Size goes. Then Resistance is the last axis of an item with variants.
        await run({ type: 'item.removeAxis', itemId: item, attributeId: size })
        const skipped = await run({ type: 'item.removeAttribute', itemId: item, attributeId: ohm })
        expect(skipped.patch!.itemAttributes.find((r) => r.attributeId === ohm)).toMatchObject({ axisPosition: 0 })
        await run({ type: 'attribute.delete', id: ohm })

        const fresh = await storage.loadInventory(inv)
        const links = Object.fromEntries(fresh.itemAttributes.map((r) => [r.attributeId, [r.axisPosition, r.value]]))
        expect(links).toEqual({ [ohm]: [0, null], [size]: [null, null] })
        expect(fresh.attributes.map((x) => x.id)).toContain(ohm)
        expect(fresh.variantAttributeValues.map((r) => [r.variantId, r.attributeId, r.value]).sort()).toEqual(
          [[a, ohm, '1000'], [b, ohm, '4700']].sort(),
        )
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

      it('restores a backup: new ids twice without duplicates, then the same ids after the original is gone', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = await seedRich(storage, `restore-${name}`)
        const backup = { inventories: [await storage.exportInventory(inv)] }
        const journal = (await storage.loadAllMovements(inv)).map(({ seq: _seq, ...m }) => m)
        const runId = newId()
        const first = await storage.restore(backup, 'new-ids', runId)
        // A second run of the same file (after a break, say) adds nothing.
        expect(await storage.restore(backup, 'new-ids', runId)).toEqual(first)
        const m = (id: string) => uuidV5(id, runId)
        expect(first.inventoryIds).toEqual([m(inv)])
        const copy = await storage.loadInventory(m(inv))
        expect(normSnapshot(copy)).toEqual(normSnapshot(renamed(backup.inventories[0]!.snapshot, m)))
        expect((await storage.loadAllMovements(m(inv))).length).toBe(journal.length)

        await storage.apply({ type: 'archive', target: 'inventory', id: inv, archiveId: newId() }, TEST_ACTOR)
        await storage.apply({ type: 'deletePermanently', target: 'inventory', id: inv }, TEST_ACTOR)
        await storage.restore(backup, 'same-ids', newId())
        expect(normSnapshot(await storage.loadInventory(inv))).toEqual(normSnapshot(backup.inventories[0]!.snapshot))
        expect((await storage.loadAllMovements(inv)).map(({ seq: _seq, ...m }) => m)).toEqual(journal)
        // Some forty writes to seed it, one round trip each: slow over the websocket.
      }, 180_000)

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

  // Plan 6 carry-over: writes and a migration queue on the revision row. Without the migration taking it first, a write
  // holding the row and waiting for the table the migration altered would deadlock with it.
  describe('migration from schema 3', () => {
    beforeAll(resetSchema)

    it('migrates while an app of schema 3 writes; writes queue on the revision row; the journal refuses UPDATE', async () => {
      const writer = createNeonWsExecutor(url!)
      const migrator = createNeonWsExecutor(url!)
      try {
        expect(await ensureSchema(writer, 3)).toMatchObject({ state: 'ready', dbVersion: 3 })
        // Schema 3's writes: the revision lock, the command, the bump (its reads back name no new column either).
        const write = (c: Command) => writer.batch([LOCK_REV, ...toStatements(normalizeCommand(c), TEST_ACTOR), REV_BUMP])
        const [inv, item] = [newId(), newId()]
        await write({ type: 'inventory.create', id: inv, name: 'migrate', description: null, currency: 'USD' })
        await write({
          ...(itemCreate(inv, item, 'R') as Extract<Command, { type: 'item.create' }>),
          initialReceipt: { movementId: newId(), quantity: '5' as Quantity, totalPrice: null, sourceUrl: null },
        })
        // Inserts into the table the migration alters, sent together with it.
        const [status, ...writes] = await Promise.all([
          ensureSchema(migrator),
          ...[0, 1, 2, 3].map((i) => write(attributeCreate(inv, newId(), `A${i}`))),
        ])
        expect(status).toEqual({ state: 'ready', dbVersion: 4, appVersion: 4, minAppSchema: 3 })
        const prevRevs = writes.map((rows) => rows[0]?.[0]?.value)
        const revs = writes.map((rows) => rows.at(-1)?.[0]?.value)
        // All went through (no deadlock), each after a different revision: none ran beside another.
        expect(new Set(prevRevs).size).toBe(writes.length)
        expect(new Set(revs).size).toBe(writes.length)
        // The app of schema 3 still writes: min_app_schema is 3.
        expect(await ensureSchema(writer, 3)).toEqual({ state: 'ready', dbVersion: 4, appVersion: 3, minAppSchema: 3 })

        const { storage } = await openPostgresStorage(migrator)
        const snapshot = await storage.loadInventory(inv)
        expect(snapshot.attributes.map((a) => [a.name, a.pinned]).sort()).toEqual(
          [['A0', false], ['A1', false], ['A2', false], ['A3', false]],
        )
        await expect(migrator.batch([sql`update movements set note = 'edited' where item_id = ${item}`])).rejects.toThrow(
          /gm_movements_append_only/,
        )
        await storage.apply({ type: 'archive', target: 'item', id: item, archiveId: newId() }, TEST_ACTOR)
        await storage.apply({ type: 'deletePermanently', target: 'item', id: item }, TEST_ACTOR)
        expect(await migrator.query(sql`select 1 from movements where item_id = ${item}`)).toEqual([])
      } finally {
        await writer.close()
        await migrator.close()
      }
    })
  })
})
