import {
  newId,
  StorageError,
  type Id,
  type InventoryExport,
  type InventoryStorage,
  type Movement,
  type Quantity,
} from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import type { PgExecutor } from '../src/executor'
import { RESTORE_BATCH_ROWS, RESTORE_TABLES, restoreBackup, uuidV5 } from '../src/restore'
import { LOCK_REV, REV_BUMP } from '../src/migrator'
import { sql, type Statement } from '../src/sql'
import { openPostgresStorage } from '../src/storage'
import { makeExecutor, normSnapshot, TEST_ACTOR } from './helpers'
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

/** Every row of every GrayMatter table, `seq` left out (a restored movement gets a new one), as JSON keyed by table. */
async function allRows(exec: PgExecutor): Promise<Map<string, string[]>> {
  const tables = await exec.query<{ table_name: string }>(
    sql`select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'gm_meta' order by table_name`,
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
          where table_schema = 'public' and table_name <> 'gm_meta' order by table_name, column_name`,
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
  })

  it('same-ids: an export restored into an empty database gives the same snapshots and journal', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const second = await seedRich(source, 'Second')
    await source.apply({ type: 'archive', target: 'inventory', id: second, archiveId: newId() }, TEST_ACTOR)
    const backup = await exported(source)

    const target = await makeStorage()
    const progress: [number, number][] = []
    const result = await target.restore(backup, 'same-ids', newId(), (done, total) => progress.push([done, total]))

    expect(result.inventoryIds).toEqual(backup.inventories.map((e) => e.snapshot.inventory.id))
    expect((await target.listInventories()).inventories).toEqual((await source.listInventories()).inventories)
    for (const id of [inv, second]) {
      expect(normSnapshot(await target.loadInventory(id))).toEqual(normSnapshot(await source.loadInventory(id)))
      expect(withoutSeq(await target.loadAllMovements(id))).toEqual(withoutSeq(await source.loadAllMovements(id)))
    }
    const total = progress[0]![1]
    expect(progress[0]).toEqual([0, total])
    expect(progress.at(-1)).toEqual([total, total])
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

    const { inventoryIds } = await storage.restore(backup, 'new-ids', runId)

    const m = (id: Id) => uuidV5(id, runId)
    expect(inventoryIds).toEqual([m(inv)])
    expect((await storage.listInventories()).inventories.map((i) => i.id).sort()).toEqual([inv, m(inv)].sort())
    // The original is untouched; the copy is the original with every id renamed: same stock, same journal.
    const original = await storage.loadInventory(inv)
    expect(normSnapshot(original)).toEqual(normSnapshot(backup.inventories[0]!.snapshot))
    const copy = await storage.loadInventory(m(inv))
    expect(normSnapshot(copy)).toEqual(normSnapshot(renamed(original, m)))
    const journal = withoutSeq(await storage.loadAllMovements(inv)).map((x) => ({
      ...x, id: m(x.id), itemId: m(x.itemId), variantId: x.variantId && m(x.variantId), transferId: x.transferId && m(x.transferId),
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
    }
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

    await restoreBackup(exec, backup, 'new-ids', runId, undefined, 7)
    const after = await allRows(exec)
    for (const [table, rows] of after) {
      const old = new Set(before.get(table))
      const added = rows.filter((r) => !old.has(r))
      expect(added.length, table).toBe(before.get(table)!.length)
      expect([...idsIn(new Map([[table, added]]), columns)].filter((id) => oldIds.has(id)), table).toEqual([])
    }
    // And a third run of the same file adds nothing at all.
    await restoreBackup(exec, backup, 'new-ids', runId, undefined, 7)
    expect(await allRows(exec)).toEqual(after)
  })

  it('same-ids: a run that breaks midway and is run again gives exactly the original', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const exec = await makeExecutor()
    const target = await openOn(exec)

    await expect(restoreBackup(failingAt(exec, 4), backup, 'same-ids', newId(), undefined, 5)).rejects.toThrow()
    await restoreBackup(exec, backup, 'same-ids', newId(), undefined, 5)

    expect(normSnapshot(await target.loadInventory(inv))).toEqual(normSnapshot(await source.loadInventory(inv)))
    expect(withoutSeq(await target.loadAllMovements(inv))).toEqual(withoutSeq(await source.loadAllMovements(inv)))
  })

  it('writes one transaction per RESTORE_BATCH_ROWS rows, each locking and then moving the revision on', async () => {
    const source = await makeStorage()
    const inv = await seedRich(source)
    const backup = await exported(source)
    const entry = backup.inventories[0]!
    // 1 200 more receipts of the wire.
    const wire = entry.snapshot.items.find((i) => i.name === 'Wire')!.id
    const extra: Movement[] = Array.from({ length: 1200 }, (_, i) => ({
      id: newId(), seq: 1000 + i, itemId: wire, variantId: null, kind: 'receipt', quantity: q('1'), totalPrice: null,
      sourceUrl: null, note: null, transferId: null, createdAt: '2026-11-11T10:00:00.000Z', createdBy: 'Test',
    }))
    const big = { inventories: [{ ...entry, movements: [...entry.movements, ...extra] }] }

    const exec = await makeExecutor()
    const target = await openOn(exec)
    const counting = failingAt(exec, 0)
    const { storage } = await openPostgresStorage(counting)
    counting.calls.length = 0
    const progress: [number, number][] = []
    await storage.restore(big, 'same-ids', newId(), (done, total) => progress.push([done, total]))

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
      expect(call.at(-1)!.text).toBe(REV_BUMP.text)
    }
    const stock = (await target.loadInventory(inv)).stock.find((l) => l.itemId === wire)!
    expect(stock.quantity).toBe('1211.75')
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
    await expect(target.restore(cycle, 'same-ids', newId())).rejects.toMatchObject({ code: 'failed', message: /cycle/ })
    expect((await target.listInventories()).rev).toBe(rev)
    expect((await target.listInventories()).inventories).toEqual([])
  })

  it('refuses to write on a read-only storage', async () => {
    const exec = await makeExecutor()
    await openOn(exec)
    // A database that needs a newer app to write.
    await exec.batch([sql`insert into gm_meta (key, value) values ('min_app_schema', '99') on conflict (key) do update set value = '99'`])
    const { storage } = await openPostgresStorage(exec)
    expect(storage.readOnly).toBe(true)
    await expect(storage.restore({ inventories: [] }, 'same-ids', newId())).rejects.toMatchObject({ code: 'read_only' })
  })
})

async function makeStorage(): Promise<InventoryStorage> {
  return openOn(await makeExecutor())
}
