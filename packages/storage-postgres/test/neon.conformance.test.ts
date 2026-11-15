import {
  buildIntakeCommit,
  newId,
  normalizeCommand,
  patchSnapshot,
  resolveIntake,
  type Command,
  type IntakeDraftContent,
  type InventorySnapshot,
  type Photo,
  type Quantity,
} from '@antresol/core'
import { neonConfig } from '@neondatabase/serverless'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertTestDatabase, createNeonHttpExecutor, createNeonWsExecutor, inspectSchema, type PgExecutor } from '../src'
import { toStatements } from '../src/commands'
import { ensureSchema, LOCK_REV, REV_BUMP } from '../src/migrator'
import { sql } from '../src/sql'
import { uuidV5 } from '../src/restore'
import * as schema6 from './fixtures/schema6-icon-writes'
import { openPostgresStorage } from '../src/storage'
import { attributeCreate, itemCreate, normSnapshot, RENDITION_FIELDS, sizeAxis, TEST_ACTOR, variantsCreate } from './helpers'
import { renamed, seedRich } from './restore-fixtures'

describe('assertTestDatabase', () => {
  it('rejects a database whose name does not end with _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/antresol')).toThrow(/must end with "_test"/)
  })
  it('accepts a _test database and ignores the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/antresol_test?sslmode=require')).not.toThrow()
  })
  it('rejects a _test suffix that only appears in the query string', () => {
    expect(() => assertTestDatabase('postgres://u:p@h/antresol?x=_test')).toThrow(/must end with "_test"/)
  })
})

// tests run in Node; src/ has no Node types on purpose
declare const process: { env: Record<string, string | undefined> }

const url = process.env.ANTRESOL_NEON_TEST_URL

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
          { text: 'create temp table antresol_probe (x int) on commit drop', params: [] },
          { text: 'insert into antresol_probe values (1), (2)', params: [] },
          { text: 'update antresol_probe set x = x + 1 where x = 2', params: [] },
          { text: 'select x from antresol_probe order by x', params: [] },
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

      it('runs the Plan 9 scenario: values set at once, variants with stock, a photo replaced; a newer schema refuses writes', async () => {
        const { storage } = await openPostgresStorage(exec)
        const [inv, item, cap, volt] = [newId(), newId(), newId(), newId()]
        const [a, b, c, m, p1, p2] = [newId(), newId(), newId(), newId(), newId(), newId()]
        await storage.apply({ type: 'inventory.create', id: inv, name: `plan9-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
        let copy: InventorySnapshot = await storage.loadInventory(inv)
        const step = async (cmd: Command) => {
          const r = await storage.apply(cmd, TEST_ACTOR)
          expect(r.patch, cmd.type).not.toBeNull()
          copy = patchSnapshot(copy, r.patch!)
        }
        const values = (variantId: string) =>
          Object.fromEntries(copy.variantAttributeValues.filter((r) => r.variantId === variantId).map((r) => [r.attributeId, r.value]))
        await step(itemCreate(inv, item, 'Capacitor'))
        await step(attributeCreate(inv, cap, 'Capacitance', 'number', { unit: 'F', siPrefixes: true }))
        await step(attributeCreate(inv, volt, 'Voltage', 'number', { unit: 'V' }))
        await step({ type: 'item.addAxis', itemId: item, attributeId: cap, firstVariantId: newId() })
        await step({ type: 'item.addAxis', itemId: item, attributeId: volt, firstVariantId: newId() })
        const pair = (x: string, y: string) => [{ attributeId: cap, value: x }, { attributeId: volt, value: y }]
        await step({
          type: 'variant.createMany',
          itemId: item,
          variants: [
            { id: a, values: pair('0.0000001', '50'), initialReceipt: { movementId: m, quantity: '10' as Quantity } },
            { id: b, values: pair('0.00000022', '50') },
            { id: c, values: pair('0.00000047', '16') },
          ],
        })
        expect((await storage.loadMovements(item)).map((x) => [x.id, x.variantId, x.quantity])).toEqual([[m, a, '10']])
        const set = (rows: [string, Record<string, string | null>][]): Command => ({
          type: 'variant.setValues',
          itemId: item,
          rows: rows.map(([variantId, v]) => ({ variantId, values: Object.entries(v).map(([attributeId, value]) => ({ attributeId, value })) })),
        })
        // C2: 100n·50V -> 220n·25V next to 220n·50V; then b and c trade their values.
        await step(set([[a, { [cap]: '0.00000022', [volt]: '25' }]]))
        await step(set([[b, { [cap]: '0.00000047', [volt]: '16' }], [c, { [cap]: '0.00000022', [volt]: '50' }]]))
        // Sent unvalidated, as from a copy that is behind: c would equal b. Refused whole (AN004), nothing written.
        const revBefore = (await storage.listInventories()).rev
        await expect(
          storage.apply(set([[a, { [volt]: '35' }], [c, { [cap]: '0.00000047', [volt]: '16' }]]), TEST_ACTOR),
        ).rejects.toMatchObject({ code: 'conflict' })
        expect((await storage.listInventories()).rev).toBe(revBefore)
        expect(normSnapshot(copy)).toEqual(normSnapshot(await storage.loadInventory(inv)))
        expect([values(a), values(b), values(c)]).toEqual([
          { [cap]: '0.00000022', [volt]: '25' },
          { [cap]: '0.00000047', [volt]: '16' },
          { [cap]: '0.00000022', [volt]: '50' },
        ])
        await step({
          type: 'photo.add', id: p1, itemId: item, variantId: b, provider: 'imgbb', fileId: 'f1', url: 'https://i.example/f1',
          ...RENDITION_FIELDS,
        })
        // jsonb comes back through this driver as a list of objects, not JSON text: in the write's reads and in a load.
        const stored = (p: Photo | undefined) => p && { urls: p.urls, width: p.width, height: p.height, deleteHandle: p.deleteHandle }
        expect(stored(copy.photos.find((p) => p.id === p1))).toEqual(RENDITION_FIELDS)
        expect(stored((await storage.loadInventory(inv)).photos.find((p) => p.id === p1))).toEqual(RENDITION_FIELDS)
        const replace = (id: string, replaces: string | null): Command => ({
          type: 'photo.replace', variantId: b, id, itemId: item, replaces, provider: 'imgbb', fileId: id, url: `https://i.example/${id}`,
        })
        await step(replace(p2, p1))
        expect(copy.photos.map((p) => [p.id, p.variantId, p.position])).toEqual([[p2, b, 0]])
        // A newer photo, then the first replace again (a late replay): the newer one stays.
        const p3 = newId()
        await step(replace(p3, p2))
        await step(replace(p2, p1))
        expect(copy.photos.map((p) => [p.id, p.variantId, p.position])).toEqual([[p3, b, 0]])
        expect(normSnapshot(copy)).toEqual(normSnapshot(await storage.loadInventory(inv)))

        // G3: another device moved the database past this app after it opened: the write is refused, nothing written.
        const [{ value: min }] = (await exec.query(sql`select value from antresol_meta where key = 'min_app_schema'`)) as [{ value: string }]
        await exec.batch([sql`update antresol_meta set value = '99' where key = 'min_app_schema'`])
        try {
          const rev = (await storage.listInventories()).rev
          await expect(storage.apply(itemCreate(inv, newId(), 'Late'), TEST_ACTOR)).rejects.toMatchObject({ code: 'read_only' })
          expect((await storage.listInventories()).rev).toBe(rev)
          expect((await storage.loadInventory(inv)).items.map((i) => i.id)).toEqual([item])
        } finally {
          await exec.batch([sql`update antresol_meta set value = ${min} where key = 'min_app_schema'`])
        }
      })

      it('runs the intakes scenario: drafts leave rev, a stale commit is refused, the commit is one batch, a retry adds nothing', async () => {
        const { storage } = await openPostgresStorage(exec)
        const run = (c: Command) => storage.apply(c, TEST_ACTOR)
        const [inv, cap, size, vS, made, intakeId] = [newId(), newId(), newId(), newId(), newId(), newId()]
        await run({ type: 'inventory.create', id: inv, name: `intakes-${name}`, description: null, currency: 'USD' })
        await run(itemCreate(inv, cap, 'Capacitor'))
        for (const c of sizeAxis(inv, cap, size)) await run(c)
        await run(variantsCreate(cap, [[vS, { [size]: 'S' }]]))
        const ids = () => ({ movementId: newId(), variantId: newId(), photoId: newId() })
        const content: IntakeDraftContent = {
          newItems: [{ id: made, name: 'Fuse', folderId: null, unitKey: 'pcs', attributes: [] }],
          lines: [
            { id: newId(), itemId: cap, axisValues: [{ attributeId: size, value: 'S' }], quantity: '5' as Quantity, totalPrice: 50,
              sourceUrl: null, photo: { provider: 'imgbb', fileId: 'f', url: 'https://i.ibb.co/abc/full.jpg', ...RENDITION_FIELDS, replace: false }, ids: ids() },
            { id: newId(), itemId: cap, axisValues: [{ attributeId: size, value: 'M' }], quantity: '2' as Quantity, totalPrice: null,
              sourceUrl: null, photo: null, ids: ids() },
            { id: newId(), itemId: made, axisValues: [], quantity: '1' as Quantity, totalPrice: null, sourceUrl: null, photo: null, ids: ids() },
          ],
        }
        const header = { shop: 'LCSC', orderNumber: null, purchasedOn: '2026-11-13', note: null }
        const rev0 = (await storage.listInventories()).rev
        const saved = await storage.saveIntakeDraft({ id: intakeId, inventoryId: inv, header, content }, null, TEST_ACTOR)
        if (!saved.saved) throw new Error('not saved')
        expect((await storage.listInventories()).rev).toBe(rev0)
        const stale = await storage.saveIntakeDraft({ id: intakeId, inventoryId: inv, header, content }, null, TEST_ACTOR)
        expect(stale).toMatchObject({ saved: false, reason: 'changed', current: { id: intakeId, draft: content, draftRev: saved.draftRev } })

        const { snapshot, rev } = await storage.loadInventoryWithRev(inv)
        const intake = (await storage.listIntakes(inv)).intakes[0]!
        const commit = buildIntakeCommit(intake, resolveIntake(intake.draft!, snapshot), snapshot, rev)
        await run({ type: 'folder.create', id: newId(), inventoryId: inv, parentId: null, name: 'Shelf', description: null })
        const behind = (await storage.listInventories()).rev
        await expect(run(commit)).rejects.toMatchObject({ code: 'conflict' })
        expect((await storage.listInventories()).rev).toBe(behind)

        const fresh = await storage.loadInventoryWithRev(inv)
        const r = await run(buildIntakeCommit(intake, resolveIntake(intake.draft!, fresh.snapshot), fresh.snapshot, fresh.rev))
        const after = await storage.loadInventory(inv)
        expect(normSnapshot(patchSnapshot(fresh.snapshot, r.patch!))).toEqual(normSnapshot(after))
        expect([...r.patch!.itemIds].sort()).toEqual([cap, made].sort())
        expect((await storage.loadAllMovements(inv)).filter((m) => m.intakeId === intakeId)).toHaveLength(3)
        expect(after.photos).toEqual([expect.objectContaining({ variantId: vS, ...RENDITION_FIELDS })])
        expect((await storage.listIntakes(inv)).intakes[0]).toMatchObject({ status: 'committed', draft: null, lines: expect.any(Array) })
        // The same command again, after the revision moved on: nothing more.
        await run(commit)
        expect(normSnapshot(await storage.loadInventory(inv))).toEqual(normSnapshot(after))
        const updated = await storage.updateIntakeHeader(intakeId, { ...header, note: 'late' }, TEST_ACTOR)
        expect(updated.intakesRev).toBe(await storage.intakesRev())
        expect((await storage.listIntakes(inv)).intakes[0]!.header.note).toBe('late')
      })

      it('concurrent applies are serialized on the revision row', async () => {
        // Deterministic: one transaction holds the revision row (pg_sleep under LOCK_REV); an apply is sent only once
        // that hold is seen running, and the hold ends only after the apply is seen waiting for the row's lock.
        const holder = make()
        const writer = make()
        const watcher = make()
        const tag = `antresol_race_${newId().replace(/-/g, '')}`
        /** Sessions other than the watcher's own whose current statement matches `pattern` (and `where`). */
        const sessions = async (pattern: string, where = 'true'): Promise<number> => {
          const [row] = await watcher.query<{ n: number }>({
            text: `select count(*)::int as n from pg_stat_activity
                    where pid <> pg_backend_pid() and state = 'active' and query like $1 and ${where}`,
            params: [pattern],
          })
          return row?.n ?? 0
        }
        const until = async (what: string, seen: () => Promise<boolean>): Promise<void> => {
          for (let tries = 0; tries < 200; tries++) {
            if (await seen()) return
            await new Promise((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(`never saw ${what}`)
        }
        try {
          const { storage } = await openPostgresStorage(writer)
          const inv = newId()
          await storage.apply({ type: 'inventory.create', id: inv, name: `race-${name}`, description: null, currency: 'USD' }, TEST_ACTOR)
          // The other writer: the revision lock, a sleep long enough to see the apply wait behind it, the bump.
          const holding = holder.batch([LOCK_REV, { text: `select pg_sleep(6) as ${tag}`, params: [] }, REV_BUMP])
          // Awaited below; a failure while still waiting to see it must not surface as an unhandled rejection.
          holding.catch(() => {})
          await until('the hold of the revision row', async () => (await sessions(`%${tag}%`)) > 0)
          const applying = storage.apply(
            { type: 'folder.create', id: newId(), inventoryId: inv, parentId: null, name: 'queued', description: null },
            TEST_ACTOR,
          )
          applying.catch(() => {})
          await until('the apply wait for the revision row', async () =>
            (await sessions('%antresol_meta%for update%', `wait_event_type = 'Lock'`)) > 0,
          )
          const [held, applied] = await Promise.all([holding, applying])
          const heldRev = held.at(-1)?.[0]?.value
          expect(typeof heldRev).toBe('string')
          // The apply read the revision only once the hold committed: exactly the one it wrote.
          expect(applied.prevRev).toBe(heldRev)
          expect(applied.rev).not.toBe(heldRev)
        } finally {
          await Promise.all([holder.close(), writer.close(), watcher.close()])
        }
      }, 60_000)

      it('restores a backup: new ids twice without duplicates; the same ids refused next to the copy unless resuming', async () => {
        const { storage } = await openPostgresStorage(exec)
        const inv = await seedRich(storage, `restore-${name}`)
        const backup = { inventories: [await storage.exportInventory(inv)] }
        const journal = (await storage.loadAllMovements(inv)).map(({ seq: _seq, ...m }) => m)
        const runId = newId()
        const first = await storage.restore(backup, 'new-ids', runId)
        expect(first.added.inventories).toBe(1)
        // A second run of the same file (after a break, say) adds nothing.
        expect(await storage.restore(backup, 'new-ids', runId)).toEqual({ ...first, added: { inventories: 0, rows: 0 } })
        const m = (id: string) => uuidV5(id, runId)
        expect(first.inventoryIds).toEqual([m(inv)])
        const copy = await storage.loadInventory(m(inv))
        expect(normSnapshot(copy)).toEqual(normSnapshot(renamed(backup.inventories[0]!.snapshot, m)))
        expect((await storage.loadAllMovements(m(inv))).length).toBe(journal.length)

        await storage.apply({ type: 'archive', target: 'inventory', id: inv, archiveId: newId() }, TEST_ACTOR)
        await storage.apply({ type: 'deletePermanently', target: 'inventory', id: inv }, TEST_ACTOR)
        // The copy is still there: the same ids only as a run that goes on with an earlier one.
        await expect(storage.restore(backup, 'same-ids', newId())).rejects.toMatchObject({ code: 'not_empty' })
        await storage.restore(backup, 'same-ids', newId(), { resumeSameIds: true })
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
        // An app of schema 3 names no `icon` column (frozen inserts of schema 6).
        const asOld = (c: Command) => {
          const n = normalizeCommand(c)
          if (n.type === 'folder.create') return [schema6.folderCreate(n, TEST_ACTOR)]
          if (n.type === 'item.create') return schema6.itemCreate(n, TEST_ACTOR)
          return toStatements(n, TEST_ACTOR)
        }
        const write = (c: Command) => writer.batch([LOCK_REV, ...asOld(c), REV_BUMP])
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
        expect(status).toEqual({ state: 'ready', dbVersion: 7, appVersion: 7, minAppSchema: 3 })
        const prevRevs = writes.map((rows) => rows[0]?.[0]?.value)
        const revs = writes.map((rows) => rows.at(-1)?.[0]?.value)
        // All went through (no deadlock), each after a different revision: none ran beside another.
        expect(new Set(prevRevs).size).toBe(writes.length)
        expect(new Set(revs).size).toBe(writes.length)
        // The app of schema 3 still writes: min_app_schema is 3.
        expect(await ensureSchema(writer, 3)).toEqual({ state: 'ready', dbVersion: 7, appVersion: 3, minAppSchema: 3 })

        const { storage } = await openPostgresStorage(migrator)
        const snapshot = await storage.loadInventory(inv)
        expect(snapshot.attributes.map((a) => [a.name, a.pinned]).sort()).toEqual(
          [['A0', false], ['A1', false], ['A2', false], ['A3', false]],
        )
        await expect(migrator.batch([sql`update movements set note = 'edited' where item_id = ${item}`])).rejects.toThrow(
          /antresol_movements_append_only/,
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
