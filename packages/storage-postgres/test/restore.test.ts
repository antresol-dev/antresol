import {
  newId,
  StorageError,
  type Id,
  type InventoryExport,
  type InventoryStorage,
  type Movement,
  type Quantity,
} from '@antresol/core'
import { describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { backupProblems, RESTORE_BATCH_ROWS, RESTORE_TABLES, renameIntakeIds, restoreBackup, uuidV5 } from '../src/restore'
import { LOCK_REV, REV_BUMP } from '../src/migrator'
import { sql, type Statement } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor, normSnapshot, RENDITION_FIELDS, TEST_ACTOR } from './helpers'
import { renamed, seedRich } from './restore-fixtures'

const q = (s: string) => s as Quantity

async function openOn(exec: PgExecutor): Promise<InventoryStorage> {
  return (await openPostgresStorage(exec)).storage
}

async function exported(storage: InventoryStorage): Promise<{ inventories: InventoryExport[] }> {
  const { inventories } = await storage.listInventories()
  return { inventories: await Promise.all(inventories.map((i) => storage.exportInventory(i.id))) }
}

const withoutSeq = (movements: Movement[]) => movements.map(({ seq: _seq, ...m }) => m)

/** Every row of every Antresol table, `seq` left out (a restored movement gets a new one), as JSON keyed by table. */
async function allRows(exec: PgExecutor): Promise<Map<string, string[]>> {
  const tables = await exec.query<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'antresol_meta' order by table_name`,
  )
  const out = new Map<string, string[]>()
  for (const { table_name } of tables) {
    const rows = await exec.query<Record<string, unknown>>({ text: `select * from "${table_name}"`, params: [] })
    out.set(table_name, rows.map(({ seq: _seq, ...r }) => JSON.stringify(r)))
  }
  return out
}

/** The uuid columns of the schema, read from the database. */
async function uuidColumns(exec: PgExecutor): Promise<{ table: string; column: string }[]> {
  const rows = await exec.query<{ table_name: string; column_name: string }>(
    sql`select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type = 'uuid' order by table_name, column_name`,
  )
  return rows.map((r) => ({ table: r.table_name, column: r.column_name }))
}

/** Every value of every uuid column, and every custom unit key, of the given rows (JSON from allRows). */
function idsIn(rows: Map<string, string[]>, columns: { table: string; column: string }[]): Set<string> {
  const ids = new Set<string>()
  for (const [table, list] of rows) {
    const names = columns.filter((c) => c.table === table).map((c) => c.column)
    for (const json of list) {
      const row = JSON.parse(json) as Record<string, unknown>
      for (const name of names) if (typeof row[name] === 'string') ids.add(row[name] as string)
      if (typeof row.unit_key === 'string' && row.unit_key.startsWith('custom:')) ids.add(row.unit_key.slice('custom:'.length))
    }
  }
  return ids
}

/** Old ids that still occur anywhere in the text of an added row's jsonb columns (intakes.draft, intakes.lines). */
function oldIdsInJson(rows: string[], oldIds: Set<string>): string[] {
  const text = rows.map((json) => {
    const row = JSON.parse(json) as Record<string, unknown>
    return JSON.stringify([row.draft, row.lines])
  }).join('\n')
  return [...oldIds].filter((id) => text.includes(id))
}

/** An executor that records its batches; batch number `failAt` (1-based; 0: none) fails before reaching the database,
 *  like a dropped connection. */
function failingAt(exec: PgExecutor, failAt: number): PgExecutor & { calls: Statement[][] } {
  const wrapped = {
    ...exec,
    calls: [] as Statement[][],
    async batch(statements: Statement[]) {
      wrapped.calls.push(statements)
      if (wrapped.calls.length === failAt) throw new StorageError('unavailable', 'connection dropped')
      return exec.batch(statements)
    },
  }
  return wrapped
}

/** The StorageError `run` rejects with (it must reject). `toMatchObject` does not test a RegExp against an Error's
 *  message, so messages are checked on what this returns. */
async function refusal(run: Promise<unknown>): Promise<StorageError> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error).toBeInstanceOf(StorageError)
  return error as StorageError
}

describe('uuidV5', () => {
  it('matches RFC 4122 v5 (Python uuid.uuid5)', () => {
    const dns = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
    expect(uuidV5('python.org', dns)).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
    expect(uuidV5('www.example.com', dns)).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    // Namespace and name over one SHA-1 block: two blocks.
    expect(uuidV5('0192f3a0-1111-7000-8000-00000000abcd', '0192f3a0-0000-7000-8000-000000000001')).toBe(
      '84bad256-35d5-5481-b516-128f002925dd',
    )
  })

  it('refuses a namespace that is not a uuid', () => {
    expect(() => uuidV5('x', 'run-1')).toThrow()
  })
})

describe('restore', () => {
  it('writes every column of every table, and remaps every uuid column of the schema in new-ids mode', async () => {
    const exec = await makeExecutor()
    await openOn(exec)
    const columns = await exec.query<{ table_name: string; column_name: string; data_type: string }>(
      sql`select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name <> 'antresol_meta' order by table_name, column_name`,
    )
    const declared = new Map(RESTORE_TABLES.map((t) => [t.name, new Map(t.columns.map((c) => [c.name, c]))]))
    expect([...declared.keys()].sort()).toEqual([...new Set(columns.map((c) => c.table_name))].sort())
    for (const { table_name, column_name, data_type } of columns) {
      // seq is GENERATED ALWAYS: a restored movement gets a new one, in the backup's order.
      if (table_name === 'movements' && column_name === 'seq') continue
      const column = declared.get(table_name)?.get(column_name)
      expect(column, `${table_name}.${column_name}`).toBeDefined()
      if (data_type === 'uuid') expect(column!.ref, `${table_name}.${column_name}`).toBe('id')
    }
    expect(declared.get('items')!.get('unit_key')!.ref).toBe('unitKey')
    // The conflict target of each insert is the table's primary key, as the database has it.
    const keys = await exec.query<{ table_name: string; column_name: string }>(
      sql`select tc.table_name, kcu.column_name from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_schema = tc.constraint_schema and kcu.constraint_name = tc.constraint_name
          where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY' and tc.table_name <> 'antresol_meta'`,
    )
    for (const table of RESTORE_TABLES) {
      const key = keys.filter((k) => k.table_name === table.name).map((k) => k.column_name).sort()
      expect([...table.key].sort(), table.name).toEqual(key)
    }
  })

  it('same-ids: an export restored into an empty database gives the same snapshots and journal', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const second = await seedRich(source, 'Second')
    await source.apply({ type: 'archive', target: 'inventory', id: second, archiveId: newId() }, TEST_ACTOR)
    const backup = await exported(source)

    const target = await makeStorage()
    const progress: [number, number][] = []
    const result = await target.restore(backup, 'same-ids', newId(), { onProgress: (done, total) => progress.push([done, total]) })

    expect(result.inventoryIds).toEqual(backup.inventories.map((e) => e.snapshot.inventory.id))
    expect(result.added).toEqual({ inventories: 2, rows: progress.at(-1)![1] })
    expect((await target.listInventories()).inventories).toEqual((await source.listInventories()).inventories)
    for (const id of [inv, second]) {
      expect((await target.listIntakes(id)).intakes).toEqual((await source.listIntakes(id)).intakes)
      expect((await source.listIntakes(id)).intakes.map((i) => i.status).sort()).toEqual(['committed', 'draft'])
      expect(normSnapshot(await target.loadInventory(id))).toEqual(normSnapshot(await source.loadInventory(id)))
      expect(withoutSeq(await target.loadAllMovements(id))).toEqual(withoutSeq(await source.loadAllMovements(id)))
    }
    // The photo with renditions comes back with the same list (jsonb travels as JSON text), the others with none.
    const photos = (await target.loadInventory(inv)).photos
    expect(photos.find((p) => p.urls !== null)).toMatchObject(RENDITION_FIELDS)
    expect(photos.filter((p) => p.urls === null).map((p) => [p.width, p.height, p.deleteHandle])).toEqual([[null, null, null]])
    const total = progress[0]![1]
    expect(progress[0]).toEqual([0, total])
    expect(progress.at(-1)).toEqual([total, total])
  })

  it('keeps the icons in both modes, and a backup without the field restores with none', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const iconsOf = (snap: { folders: { icon: string | null }[]; items: { icon: string | null }[] }) =>
      [...snap.folders, ...snap.items].map((r) => r.icon).filter((i) => i !== null).sort()
    expect(iconsOf(backup.inventories[0]!.snapshot)).toEqual(['microchip', 'package-open'])

    const same = await makeStorage()
    await same.restore(backup, 'same-ids', newId())
    expect(iconsOf(await same.loadInventory(inv))).toEqual(['microchip', 'package-open'])
    const copy = await source.restore(backup, 'new-ids', newId())
    expect(iconsOf(await source.loadInventory(copy.inventoryIds[0]!))).toEqual(['microchip', 'package-open'])

    // A file of schema 6 and older: the rows have no `icon` at all.
    const old = JSON.parse(JSON.stringify(backup)) as { inventories: { snapshot: { folders: Record<string, unknown>[]; items: Record<string, unknown>[] } }[] }
    for (const e of old.inventories) for (const r of [...e.snapshot.folders, ...e.snapshot.items]) delete r.icon
    const target = await makeStorage()
    await target.restore(old as unknown as typeof backup, 'same-ids', newId())
    const snap = await target.loadInventory(inv)
    expect(snap.folders.length + snap.items.length).toBeGreaterThan(0)
    expect(iconsOf(snap)).toEqual([])
  })

  it('keeps the colours of items and tags in both modes, and a backup without the field restores with none', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const colorsOf = (snap: { items: { color: string | null }[]; tags: { color: string | null }[] }) =>
      [...snap.items, ...snap.tags].map((r) => r.color).filter((c) => c !== null).sort()
    expect(colorsOf(backup.inventories[0]!.snapshot)).toEqual(['#0D9488', '#4F46E5'])

    const same = await makeStorage()
    await same.restore(backup, 'same-ids', newId())
    expect(colorsOf(await same.loadInventory(inv))).toEqual(['#0D9488', '#4F46E5'])
    const copy = await source.restore(backup, 'new-ids', newId())
    expect(colorsOf(await source.loadInventory(copy.inventoryIds[0]!))).toEqual(['#0D9488', '#4F46E5'])

    // A file of schema 7 and older: the rows have no `color` at all.
    const old = JSON.parse(JSON.stringify(backup)) as { inventories: { snapshot: { items: Record<string, unknown>[]; tags: Record<string, unknown>[] } }[] }
    for (const e of old.inventories) for (const r of [...e.snapshot.items, ...e.snapshot.tags]) delete r.color
    const target = await makeStorage()
    await target.restore(old as unknown as typeof backup, 'same-ids', newId())
    const snap = await target.loadInventory(inv)
    expect(snap.items.length + snap.tags.length).toBeGreaterThan(0)
    expect(colorsOf(snap)).toEqual([])
  })

  it('new-ids: restored next to the original, a second copy whose ids are UUID v5 of the old ones in the run', async () => {
    const exec = await makeExecutor()
    const storage = await openOn(exec)
    const inv = await seedRich(storage)
    const backup = await exported(storage)
    const columns = await uuidColumns(exec)
    const before = await allRows(exec)
    const oldIds = idsIn(before, columns)
    const runId = newId()

    const { inventoryIds, added } = await storage.restore(backup, 'new-ids', runId)

    const m = (id: Id) => uuidV5(id, runId)
    expect(inventoryIds).toEqual([m(inv)])
    expect(added).toEqual({ inventories: 1, rows: [...before.values()].flat().length })
    expect((await storage.listInventories()).inventories.map((i) => i.id).sort()).toEqual([inv, m(inv)].sort())
    // The original is untouched; the copy is the original with every id renamed: same stock, same journal.
    const original = await storage.loadInventory(inv)
    expect(normSnapshot(original)).toEqual(normSnapshot(backup.inventories[0]!.snapshot))
    const copy = await storage.loadInventory(m(inv))
    expect(normSnapshot(copy)).toEqual(normSnapshot(renamed(original, m)))
    const journal = withoutSeq(await storage.loadAllMovements(inv)).map((x) => ({
      ...x, id: m(x.id), itemId: m(x.itemId), variantId: x.variantId && m(x.variantId), transferId: x.transferId && m(x.transferId), intakeId: x.intakeId && m(x.intakeId),
    }))
    expect(withoutSeq(await storage.loadAllMovements(m(inv)))).toEqual(journal)

    // No restored row refers to an old id, in any uuid column of the schema or a custom unit key.
    const after = await allRows(exec)
    for (const [table, rows] of after) {
      const old = new Set(before.get(table))
      const added = rows.filter((r) => !old.has(r))
      expect(added.length, table).toBe(before.get(table)!.length)
      const leaked = [...idsIn(new Map([[table, added]]), columns)].filter((id) => oldIds.has(id))
      expect(leaked, table).toEqual([])
      if (table === 'intakes') {
        expect(added.length).toBe(2)
        expect(oldIdsInJson(added, oldIds), 'intakes jsonb').toEqual([])
      }
    }
    // The movements the committed intake made point at the copy of it, and its lines at the copy's movements.
    const rows = await exec.query<{ id: string; lines: { movementId: string }[] | null; draft: unknown }>(
      sql`select id, lines, draft from intakes where inventory_id = ${m(inv)}`,
    )
    const committed = rows.find((r) => r.lines)!
    const made = await exec.query<{ id: string }>(sql`select id from movements where intake_id = ${committed.id}`)
    expect(made.map((r) => r.id).sort()).toEqual(committed.lines!.map((l) => l.movementId).sort())
    expect(made.length).toBeGreaterThan(0)
  })

  it('new-ids: a run that breaks after its first batch and is run again leaves no duplicate and no old id', async () => {
    const exec = await makeExecutor()
    const storage = await openOn(exec)
    await seedRich(storage)
    const backup = await exported(storage)
    const columns = await uuidColumns(exec)
    const before = await allRows(exec)
    const oldIds = idsIn(before, columns)
    const runId = newId()

    const broken = failingAt(exec, 2)
    await expect(restoreBackup(broken, backup, 'new-ids', runId, undefined, 7)).rejects.toMatchObject({ code: 'unavailable' })
    const partial = await allRows(exec)
    expect([...partial.values()].flat().length).toBe([...before.values()].flat().length + 7)

    const second = await restoreBackup(exec, backup, 'new-ids', runId, undefined, 7)
    // What the first run wrote is not counted again: its inventory row among it.
    expect(second.added).toEqual({ inventories: 0, rows: [...before.values()].flat().length - 7 })
    const after = await allRows(exec)
    for (const [table, rows] of after) {
      const old = new Set(before.get(table))
      const added = rows.filter((r) => !old.has(r))
      expect(added.length, table).toBe(before.get(table)!.length)
      expect([...idsIn(new Map([[table, added]]), columns)].filter((id) => oldIds.has(id)), table).toEqual([])
      if (table === 'intakes') expect(oldIdsInJson(added, oldIds)).toEqual([])
    }
    // And a third run of the same file adds nothing at all.
    expect((await restoreBackup(exec, backup, 'new-ids', runId, undefined, 7)).added).toEqual({ inventories: 0, rows: 0 })
    expect(await allRows(exec)).toEqual(after)
  })

  it('same-ids: a run that breaks midway and is run again gives exactly the original', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const exec = await makeExecutor()
    const target = await openOn(exec)

    await expect(restoreBackup(failingAt(exec, 4), backup, 'same-ids', newId(), undefined, 5)).rejects.toThrow()
    // The source now holds what the first run wrote: only a run that says it goes on with that one may write into it.
    const partial = await allRows(exec)
    await expect(restoreBackup(exec, backup, 'same-ids', newId(), undefined, 5)).rejects.toMatchObject({ code: 'not_empty' })
    expect(await allRows(exec)).toEqual(partial)
    await restoreBackup(exec, backup, 'same-ids', newId(), { resumeSameIds: true }, 5)

    expect(normSnapshot(await target.loadInventory(inv))).toEqual(normSnapshot(await source.loadInventory(inv)))
    expect(withoutSeq(await target.loadAllMovements(inv))).toEqual(withoutSeq(await source.loadAllMovements(inv)))
  })

  it('writes one transaction per RESTORE_BATCH_ROWS rows, each locking and then moving the revision on', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const entry = backup.inventories[0]!
    // 1 200 more receipts of the wire (11.75 before them, 2.5 of it from the seeded intake).
    const wire = entry.snapshot.items.find((i) => i.name === 'Wire')!.id
    const extra: Movement[] = Array.from({ length: 1200 }, (_, i) => ({
      id: newId(), seq: 1000 + i, itemId: wire, variantId: null, kind: 'receipt', quantity: q('1'), totalPrice: null,
      sourceUrl: null, note: null, transferId: null, intakeId: null, createdAt: '2026-11-11T10:00:00.000Z', createdBy: 'Test',
    }))
    const big = { inventories: [{ ...entry, movements: [...entry.movements, ...extra] }] }

    const exec = await makeExecutor()
    const target = await openOn(exec)
    const counting = failingAt(exec, 0)
    const { storage } = await openPostgresStorage(counting)
    counting.calls.length = 0
    const progress: [number, number][] = []
    await storage.restore(big, 'same-ids', newId(), { onProgress: (done, total) => progress.push([done, total]) })

    const total = progress[0]![1]
    expect(new Set(progress.map(([, t]) => t))).toEqual(new Set([total]))
    const batches = counting.calls.length
    expect(batches).toBe(Math.ceil(total / RESTORE_BATCH_ROWS))
    expect(progress.map(([done]) => done)).toEqual([
      0,
      ...Array.from({ length: batches }, (_, i) => Math.min((i + 1) * RESTORE_BATCH_ROWS, total)),
    ])
    for (const call of counting.calls) {
      expect(call[0]!.text).toBe(LOCK_REV.text)
      // Right after the lock, as in every write: this app may still write (AN003).
      expect(call[1]!.text).toMatch(/antresol_newer_schema/)
      expect(call.at(-1)!.text).toBe(REV_BUMP.text)
    }
    // The first batch alone then checks that the source is empty.
    expect(counting.calls[0]![2]!.text).toMatch(/antresol_restore_not_empty/)
    expect(counting.calls.slice(1).flat().some((st) => /antresol_restore_not_empty/.test(st.text))).toBe(false)
    const stock = (await target.loadInventory(inv)).stock.find((l) => l.itemId === wire)!
    expect(stock.quantity).toBe('1214.25')
  })

  it('checks every reference before writing anything', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const backup = await exported(source)
    const entry = backup.inventories[0]!
    const dangling = {
      inventories: [{ ...entry, movements: [...entry.movements, { ...entry.movements[0]!, id: newId(), itemId: newId() }] }],
    }
    const [first, second] = entry.snapshot.folders
    const cycle = {
      inventories: [{
        ...entry,
        snapshot: {
          ...entry.snapshot,
          folders: entry.snapshot.folders.map((f) =>
            f.id === first!.id ? { ...f, parentId: second!.id } : f.id === second!.id ? { ...f, parentId: first!.id } : f,
          ),
        },
      }],
    }
    const exec = await makeExecutor()
    const target = await openOn(exec)
    const rev = (await target.listInventories()).rev
    await expect(target.restore(dangling, 'new-ids', newId())).rejects.toMatchObject({ code: 'failed' })
    expect(await refusal(target.restore(cycle, 'same-ids', newId()))).toMatchObject({ code: 'failed', message: expect.stringMatching(/cycle/) })
    expect((await target.listInventories()).rev).toBe(rev)
    expect((await target.listInventories()).inventories).toEqual([])
  })

  it('refuses a movement of an intake outside the backup; an intake\'s lines and draft are history and not checked', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const entry = (await exported(source)).inventories[0]!
    const k = entry.intakes.find((i) => i.lines)!
    const orphan = { ...entry, intakes: entry.intakes.filter((i) => i.id !== k.id) }
    expect(backupProblems(orphan).join()).toMatch(/intake/)
    await expect(restoreBackup(await makeExecutor(), { inventories: [orphan] }, 'new-ids', newId())).rejects.toMatchObject({ code: 'failed' })
    // A committed line whose movement, item or variant is gone, and a draft line or new item whose item or folder is gone:
    // jsonb without foreign keys (spec §8: the line shows its saved name; a draft line is marked, not lost).
    const lostMovement = { ...entry, movements: entry.movements.filter((m) => m.id !== k.lines![0]!.movementId) }
    expect(backupProblems(lostMovement)).toEqual([])
    const draft = entry.intakes.find((i) => i.draft)!
    const strayLine = {
      ...draft,
      draft: {
        newItems: draft.draft!.newItems.map((n) => ({ ...n, folderId: newId() })),
        lines: [...draft.draft!.lines, { ...draft.draft!.lines[0]!, id: newId(), itemId: newId() }],
      },
    }
    const strayCommitted = { ...k, lines: k.lines!.map((l) => ({ ...l, itemId: newId(), variantId: newId() })) }
    expect(backupProblems({ ...entry, intakes: [strayLine, strayCommitted] })).toEqual([])
    expect(backupProblems(entry)).toEqual([])
  })

  it('restores, in both modes, an inventory whose committed intake names an item deleted permanently since', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const committed = (await source.listIntakes(inv)).intakes.find((i) => i.lines)!
    const capacitor = committed.lines!.find((l) => l.itemName === 'Capacitor')!.itemId
    const resistor = committed.lines!.find((l) => l.itemName === 'Resistor')!.itemId
    for (const item of [capacitor, resistor]) {
      await source.apply({ type: 'archive', target: 'item', id: item, archiveId: newId() }, TEST_ACTOR)
      await source.apply({ type: 'deletePermanently', target: 'item', id: item }, TEST_ACTOR)
    }
    const backup = await exported(source)
    const entry = backup.inventories[0]!
    expect(entry.snapshot.items.some((i) => i.id === capacitor || i.id === resistor)).toBe(false)
    // The draft still names the deleted resistor.
    expect(entry.intakes.find((i) => i.draft)!.draft!.lines.some((l) => l.itemId === resistor)).toBe(true)
    expect(backupProblems(entry)).toEqual([])

    const target = await makeStorage()
    await target.restore(backup, 'same-ids', newId())
    const same = (await target.listIntakes(inv)).intakes
    expect(same).toEqual((await source.listIntakes(inv)).intakes)
    expect(same.find((i) => i.id === committed.id)!.lines).toEqual(committed.lines)

    const runId = newId()
    const [copy] = (await source.restore(backup, 'new-ids', runId)).inventoryIds
    const restored = (await source.listIntakes(copy!)).intakes.find((i) => i.lines)!
    expect(restored.lines!.map((l) => l.itemName)).toEqual(committed.lines!.map((l) => l.itemName))
    expect(restored.lines!.map((l) => l.itemId)).toEqual(committed.lines!.map((l) => uuidV5(l.itemId, runId)))
  })

  it('renews the intakes revision when it writes intakes, so caches of the intakes list drop', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const backup = await exported(source)
    const target = await makeStorage()
    const before = await target.intakesRev()
    await target.restore(backup, 'same-ids', newId())
    const afterSame = await target.intakesRev()
    expect(afterSame).not.toBe(before)
    await target.restore(backup, 'new-ids', newId())
    expect(await target.intakesRev()).not.toBe(afterSame)
    // A file without intakes leaves it.
    const plain = { inventories: backup.inventories.map((e) => ({ ...e, intakes: [], movements: e.movements.filter((m) => !m.intakeId) })) }
    const settled = await target.intakesRev()
    await target.restore(plain, 'new-ids', newId())
    expect(await target.intakesRev()).toBe(settled)
  })

  it('renameIntakeIds renames every id inside a draft and a committed intake', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const { intakes } = (await exported(source)).inventories[0]!
    const m = (id: Id) => `m:${id}`
    for (const k of intakes) {
      const text = JSON.stringify(renameIntakeIds(k, m))
      const idsOf = k.draft
        ? [...k.draft.newItems.flatMap((n) => [n.id, n.folderId, ...n.attributes.map((a) => a.attributeId)]),
           ...k.draft.lines.flatMap((l) => [l.id, l.itemId, l.ids.movementId, l.ids.variantId, l.ids.photoId, ...l.axisValues.map((v) => v.attributeId)])]
        : k.lines!.flatMap((l) => [l.lineId, l.itemId, l.variantId, l.movementId])
      for (const id of idsOf) {
        if (id === null) continue
        expect(text, id).toContain(`"${m(id)}"`)
        expect(text, id).not.toContain(`"${id}"`)
      }
    }
    expect(JSON.stringify(renameIntakeIds(intakes.find((i) => i.draft)!, m))).toContain('custom:m:')
  })

  it('renameIntakeIds renames new tags and their references; a draft without them stays without', async () => {
    const m = (id: Id) => `m:${id}`
    const base = { id: 'i', inventoryId: 'v', status: 'draft', header: { shop: null, orderNumber: null, purchasedOn: '2026-11-13', note: null },
      lines: null, created: null, draftRev: 'r', createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', committedAt: null } as const
    const item = { id: 'n1', name: 'X', folderId: null, unitKey: 'pcs', attributes: [] }
    const tagged = renameIntakeIds({ ...base, draft: { newTags: [{ id: 't1', name: 'Kit' }], newItems: [{ ...item, tagIds: ['t1', 'old'] }], lines: [] } }, m)
    expect(tagged.draft!.newTags).toEqual([{ id: 'm:t1', name: 'Kit' }])
    expect(tagged.draft!.newItems[0]!.tagIds).toEqual(['m:t1', 'm:old'])
    const plain = renameIntakeIds({ ...base, draft: { newItems: [item], lines: [] } }, m)
    expect(plain.draft!.newItems[0]).not.toHaveProperty('tagIds')
    expect(plain.draft).not.toHaveProperty('newTags')
  })

  it('same-ids: refused into a source that holds any inventory, its live original or another one; nothing is written', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    // The live original, changed since the backup: the same ids would mix the two states.
    const exec = await makeExecutor()
    const target = await openOn(exec)
    await target.restore(backup, 'same-ids', newId())
    await target.apply({ type: 'folder.create', id: newId(), inventoryId: inv, parentId: null, name: 'Later', description: null }, TEST_ACTOR)
    const other = await makeExecutor()
    const otherTarget = await openOn(other)
    await seedRich(otherTarget, 'Other')
    for (const [e, storage] of [[exec, target], [other, otherTarget]] as const) {
      const rows = await allRows(e)
      const { rev } = await storage.listInventories()
      await expect(storage.restore(backup, 'same-ids', newId())).rejects.toMatchObject({ code: 'not_empty' })
      expect(await allRows(e)).toEqual(rows)
      expect((await storage.listInventories()).rev).toBe(rev)
    }
    // New ids go next to anything.
    await expect(otherTarget.restore(backup, 'new-ids', newId())).resolves.toMatchObject({ added: { inventories: 1 } })
  })

  it('skips only rows whose primary key is there: a collision on another unique index fails loudly', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const backup = await exported(source)
    const { snapshot } = backup.inventories[0]!
    const resistor = snapshot.items.find((i) => i.name === 'Resistor')!.id
    const attribute = (name: string) => snapshot.attributes.find((a) => a.name === name)!.id
    const exec = await makeExecutor()
    const target = await openOn(exec)
    await target.restore(backup, 'same-ids', newId())
    // The resistor's first axis is now Package: the backup's (Resistor, Resistance) row is missing by its primary key,
    // yet it takes axis position 0 again.
    await exec.batch([
      sql`delete from item_attributes where item_id = ${resistor}::uuid and attribute_id = ${attribute('Resistance')}::uuid`,
      sql`update item_attributes set axis_position = 0 where item_id = ${resistor}::uuid and attribute_id = ${attribute('Package')}::uuid`,
    ])
    const rows = await allRows(exec)
    expect(await refusal(target.restore(backup, 'same-ids', newId(), { resumeSameIds: true }))).toMatchObject({
      code: 'failed',
      message: expect.stringMatching(/item_attributes_axis_position_idx/),
    })
    expect(await allRows(exec)).toEqual(rows)
  })

  it('refuses, before writing anything, values the schema cannot hold', async () => {
    const source = await makeStorage()
    await seedRich(source)
    const backup = await exported(source)
    const entry = backup.inventories[0]!
    const s = entry.snapshot
    const resistor = s.items.find((i) => i.name === 'Resistor')!.id
    const withSnapshot = (patch: Partial<typeof s>) => ({ ...entry, snapshot: { ...s, ...patch } })
    const cases: [InventoryExport, RegExp][] = [
      [withSnapshot({ inventory: { ...s.inventory, currency: 'XXQ' } }), /currency/],
      [withSnapshot({ units: s.units.map((u) => ({ ...u, prefixPowers: [3, 40_000] })) }), /prefix/],
      [
        withSnapshot({ itemAttributes: s.itemAttributes.map((r) => (r.itemId === resistor && r.axisPosition === null ? { ...r, axisPosition: 1 } : r)) }),
        /axis position/,
      ],
      [withSnapshot({ variants: s.variants.map((v, i) => (i === 0 ? { ...v, position: 2 ** 31 } : v)) }), /position/],
    ]
    expect(backupProblems(entry)).toEqual([])
    const exec = await makeExecutor()
    const target = await openOn(exec)
    const rev = (await target.listInventories()).rev
    for (const [bad, reason] of cases) {
      expect(backupProblems(bad).join('; ')).toMatch(reason)
      expect(await refusal(target.restore({ inventories: [bad] }, 'new-ids', newId()))).toMatchObject({
        code: 'failed',
        message: expect.stringMatching(reason),
      })
    }
    expect((await target.listInventories()).rev).toBe(rev)
    expect((await target.listInventories()).inventories).toEqual([])
  })

  it('refuses to write on a read-only storage', async () => {
    const exec = await makeExecutor()
    await openOn(exec)
    // A database that needs a newer app to write.
    await exec.batch([sql`insert into antresol_meta (key, value) values ('min_app_schema', '99') on conflict (key) do update set value = '99'`])
    const { storage } = await openPostgresStorage(exec)
    expect(storage.readOnly).toBe(true)
    await expect(storage.restore({ inventories: [] }, 'same-ids', newId())).rejects.toMatchObject({ code: 'read_only' })
  })
})

async function makeStorage(): Promise<InventoryStorage> {
  return openOn(await makeExecutor())
}
