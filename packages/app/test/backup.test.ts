import { PGlite } from '@electric-sql/pglite'
import { newId, StorageError, type InventoryStorage, type Movement, type Quantity } from '@antresol/core'
import { APP_SCHEMA_VERSION, createPgliteExecutor, openPostgresStorage, type PgExecutor } from '@antresol/storage-postgres'
import { createStore, set } from 'idb-keyval'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backupFileName,
  backupSummary,
  buildBackup,
  createBackupReminder,
  downloadBackup,
  fingerprint,
  lastBackupAgo,
  parseBackup,
  restoreChoice,
  restoreOutcome,
  REVOKE_DELAY_MS,
  shareOrDownload,
  shouldRemindBackup,
  watchBackupReminder,
  withInventoryNames,
  type BackupFile,
} from '../app/lib/backup'
import { createMemoryDeviceDb, openDeviceDb } from '../app/lib/device-db'
import { createDemoDriver, type DemoDriver } from '../app/lib/dev/demo-source'
import { createNeonDriver } from '../app/lib/sources'
import type { SourceConfig } from '../app/lib/types'
import { createWorkspace } from '../app/lib/workspace'
import type { Workspace } from '../app/lib/workspace-types'

describe('backup file', () => {
  it('holds no connection string or key, even when the source object carries them', () => {
    const source = {
      name: 'Home',
      kind: 'neon',
      connectionString: 'postgres://u:secret@h/db',
      uploadcarePublicKey: 'pk_123',
    }
    const backup = buildBackup({ exportedAt: '2026-11-11T00:00:00Z', app: { schemaVersion: 3 }, source, inventories: [] })
    const text = JSON.stringify(backup)
    for (const forbidden of ['connectionString', 'postgres://', 'uploadcarePublicKey', 'secret', 'pk_123']) {
      expect(text).not.toContain(forbidden)
    }
    expect(backup).toMatchObject({ format: 'antresol-backup', version: 1, source: { name: 'Home', kind: 'neon' } })
    expect(Object.keys(backup.source)).toEqual(['name', 'kind'])
  })

  it('names the file from a slug of the source name', () => {
    const at = new Date('2026-11-11T10:00:00Z')
    expect(backupFileName('My Garage / #1!', at)).toBe('antresol-my-garage-1-2026-11-11.json')
    expect(backupFileName('Demo', at)).toBe('antresol-demo-2026-11-11.json')
    expect(backupFileName('???', at)).toBe('antresol-source-2026-11-11.json')
  })
})

describe('downloadBackup', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('revokes the object URL only after a delay, so the download can start', () => {
    vi.useFakeTimers()
    const click = vi.fn()
    const link = { href: '', download: '', click, remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } })
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    const backup = buildBackup({ exportedAt: 't', app: { schemaVersion: 1 }, source: { name: 'Home', kind: 'neon' }, inventories: [] })
    downloadBackup(backup, new Date('2026-11-11T00:00:00Z'))
    expect(click).toHaveBeenCalled()
    expect(link.download).toBe('antresol-home-2026-11-11.json')
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})

// ---- restore, reminder, share (Plan 8 §4.8) ----

const demoConfig: SourceConfig = {
  id: 'demo', kind: 'dev-pglite', name: 'Demo', connectionString: '', uploadcarePublicKey: null, createdAt: '2026-11-10T00:00:00Z',
}

const drivers: DemoDriver[] = []
const pglites: PGlite[] = []
afterEach(async () => {
  await Promise.all(drivers.splice(0).map((d) => d.close()))
  await Promise.all(pglites.splice(0).map((p) => p.close().catch(() => {})))
})

async function emptyStorage(): Promise<{ exec: PgExecutor; storage: InventoryStorage }> {
  const pg = new PGlite()
  pglites.push(pg)
  const exec = createPgliteExecutor(pg)
  return { exec, storage: (await openPostgresStorage(exec)).storage }
}

/** The demo data (both seeded inventories and the archived one) exported as a file is: through JSON. */
async function demoBackup(): Promise<{ storage: InventoryStorage; file: unknown }> {
  const driver = createDemoDriver({ memory: true })
  drivers.push(driver)
  const { storage } = await driver.connect(demoConfig)
  const inventories = []
  for (const { id } of (await storage.listInventories()).inventories) inventories.push(await storage.exportInventory(id))
  const backup = buildBackup({
    exportedAt: '2026-11-11T10:00:00.000Z', app: { schemaVersion: APP_SCHEMA_VERSION }, source: { name: 'Demo', kind: 'dev-pglite' }, inventories,
  })
  return { storage, file: JSON.parse(JSON.stringify(backup)) }
}

const withoutSeq = (movements: Movement[]) => movements.map(({ seq: _seq, ...m }) => m)

/** A record of a backup's raw JSON, to damage on purpose. */
type Rec = Record<string, unknown>

describe('parseBackup', () => {
  it('reads back what buildBackup wrote, through JSON', async () => {
    const { file } = await demoBackup()
    const parsed = parseBackup(file)
    expect(parsed).toEqual(file)
    expect(backupSummary(parsed as BackupFile)).toMatchObject({ inventories: 3 })
  })

  it('refuses what is not a Antresol backup', () => {
    const ok = buildBackup({ exportedAt: '2026-11-11T10:00:00Z', app: { schemaVersion: 5 }, source: { name: 'H', kind: 'neon' }, inventories: [] })
    expect(parseBackup(JSON.parse(JSON.stringify(ok)))).toEqual(ok)
    for (const bad of [null, 'text', [], {}, { ...ok, format: 'other' }, { ...ok, inventories: {} }, { ...ok, exportedAt: 'soon' }]) {
      expect(parseBackup(bad), JSON.stringify(bad)).toEqual({ error: 'format' })
    }
  })

  it('tells an unknown file version and a newer schema apart', () => {
    const ok = buildBackup({ exportedAt: '2026-11-11T10:00:00Z', app: { schemaVersion: 5 }, source: { name: 'H', kind: 'neon' }, inventories: [] })
    expect(parseBackup({ ...ok, version: 2, inventories: 'whatever' })).toEqual({ error: 'version' })
    expect(parseBackup({ ...ok, app: { schemaVersion: APP_SCHEMA_VERSION + 1 }, inventories: 'whatever' })).toEqual({ error: 'newer_schema' })
    expect(parseBackup({ ...ok, app: { schemaVersion: APP_SCHEMA_VERSION } })).toEqual({ ...ok, app: { schemaVersion: APP_SCHEMA_VERSION } })
  })

  it('refuses a record with a missing or mistyped field, keeps nothing it does not know', async () => {
    const { file } = await demoBackup()
    // The demo's Electronics inventory: folders, items and movements.
    const electronics = (file as BackupFile).inventories.findIndex((e) => e.snapshot.inventory.name === 'Electronics')
    const copy = () => {
      const all = JSON.parse(JSON.stringify(file)) as {
        inventories: { snapshot: { inventory: Rec; items: Rec[]; folders: Rec[] }; movements: Rec[] }[]
      }
      return { all, entry: all.inventories[electronics]! }
    }
    const noName = copy()
    delete noName.entry.snapshot.items[0]!.name
    expect(parseBackup(noName.all)).toEqual({ error: 'format' })
    const badId = copy()
    badId.entry.snapshot.folders[0]!.parentId = 'parent'
    expect(parseBackup(badId.all)).toEqual({ error: 'format' })
    const badQuantity = copy()
    badQuantity.entry.movements[0]!.quantity = '1e3'
    expect(parseBackup(badQuantity.all)).toEqual({ error: 'format' })
    const extra = copy()
    extra.entry.snapshot.inventory.connectionString = 'postgres://x'
    const parsed = parseBackup(extra.all)
    expect('error' in parsed).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain('postgres://')
  })

  it('reads a file of schema 3: attributes without `pinned`, stock without `lastCountedAt`', async () => {
    const { file } = await demoBackup()
    const old = JSON.parse(JSON.stringify(file)) as {
      app: { schemaVersion: number }
      inventories: { snapshot: { attributes: Rec[]; stock: Rec[] } }[]
    }
    old.app.schemaVersion = 3
    for (const { snapshot } of old.inventories) {
      for (const a of snapshot.attributes) delete a.pinned
      for (const l of snapshot.stock) delete l.lastCountedAt
    }
    const parsed = parseBackup(old) as BackupFile
    expect(parsed.app.schemaVersion).toBe(3)
    expect(parsed.inventories.flatMap((e) => e.snapshot.attributes).every((a) => a.pinned === false)).toBe(true)
    expect(parsed.inventories.flatMap((e) => e.snapshot.stock).every((l) => l.lastCountedAt === null)).toBe(true)
  })
})

describe('parseBackup: what the schema cannot hold', () => {
  type Raw = { app: { schemaVersion: number }; inventories: { snapshot: Record<string, Rec[]> & { inventory: Rec } }[] }
  async function electronics() {
    const { file } = await demoBackup()
    const all = JSON.parse(JSON.stringify(file)) as Raw
    const entry = all.inventories.find((e) => e.snapshot.inventory.name === 'Electronics')!
    return { all, s: entry.snapshot }
  }

  it('refuses, with the reason, a value the schema cannot hold or a reference that does not resolve', async () => {
    const cases: [(s: Raw['inventories'][number]['snapshot']) => void, RegExp][] = [
      [(s) => void (s.inventory.currency = 'XXQ'), /currency/],
      [(s) => void (s.units.push({ ...unitLike(s), prefixPowers: [3, 40_000] })), /prefix power/],
      [
        (s) => {
          const axis = s.itemAttributes.find((r) => r.axisPosition !== null)!
          const other = s.itemAttributes.find((r) => r.itemId === axis.itemId && r.axisPosition === null)
          if (other) other.axisPosition = axis.axisPosition
          else s.itemAttributes.push({ ...axis, attributeId: s.attributes.find((a) => a.id !== axis.attributeId)!.id })
        },
        /axis position/,
      ],
      [(s) => void (s.variants[0]!.position = 2 ** 31), /position/],
      [(s) => void (s.items[0]!.folderId = newId()), /folder/],
    ]
    for (const [damage, reason] of cases) {
      const { all, s } = await electronics()
      damage(s)
      const parsed = parseBackup(all)
      expect(parsed, String(reason)).toMatchObject({ error: 'format' })
      expect((parsed as { reason?: string }).reason, String(reason)).toMatch(reason)
    }
  })

  it('says a file of a pre-release Antresol cannot be restored, rather than calling it damaged', async () => {
    const { all, s } = await electronics()
    expect(s.variants.length).toBeGreaterThan(0)
    // Before variants were defined by their axes: variants had names, item attributes no axis position.
    all.app.schemaVersion = 3
    for (const v of s.variants) v.name = 'Variant'
    for (const r of s.itemAttributes) delete r.axisPosition
    expect(parseBackup(all)).toEqual({ error: 'prerelease' })
    const older = (await electronics()).all
    older.app.schemaVersion = 2
    expect(parseBackup(older)).toEqual({ error: 'prerelease' })
    // A schema-3 file of today's shape is read.
    const current = (await electronics()).all
    current.app.schemaVersion = 3
    expect('error' in parseBackup(current)).toBe(false)
  })
})

/** A custom unit record to damage (the demo may hold none). */
function unitLike(s: Record<string, Rec[]> & { inventory: Rec }): Rec {
  return {
    id: newId(), inventoryId: s.inventory.id, name: 'Unit', symbol: 'u', prefixPowers: [],
    createdAt: s.inventory.createdAt, updatedAt: s.inventory.updatedAt, createdBy: 'Test', updatedBy: 'Test',
  }
}

describe('withInventoryNames', () => {
  it('renames each inventory, nothing else, and leaves the original backup as it was', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const renamed = withInventoryNames(backup, (name) => `${name} (restored)`)
    expect(renamed.inventories.map((e) => e.snapshot.inventory.name).sort()).toEqual(
      ['Archive test (restored)', 'Electronics (restored)', 'Workshop (restored)'],
    )
    expect(backup.inventories.map((e) => e.snapshot.inventory.name).sort()).toEqual(['Archive test', 'Electronics', 'Workshop'])
    const strip = (b: BackupFile) => b.inventories.map((e) => ({ ...e, snapshot: { ...e.snapshot, inventory: { ...e.snapshot.inventory, name: '' } } }))
    expect(strip(renamed)).toEqual(strip(backup))
  })
})

describe('restore of the demo export', () => {
  it('same ids into an empty database gives the same snapshots and journals', async () => {
    const { storage: source, file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { storage } = await emptyStorage()
    await storage.restore(backup, 'same-ids', newId())
    for (const { snapshot } of backup.inventories) {
      expect(await storage.loadInventory(snapshot.inventory.id)).toEqual(await source.loadInventory(snapshot.inventory.id))
      expect(withoutSeq(await storage.loadAllMovements(snapshot.inventory.id))).toEqual(
        withoutSeq(await source.loadAllMovements(snapshot.inventory.id)),
      )
    }
  })
})

describe('backup reminder', () => {
  const now = new Date('2026-11-25T12:00:00Z')
  const DAY = 86_400_000
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('is due after more than 14 days or more than 200 writes since the last backup', () => {
    expect(shouldRemindBackup({ lastBackupAt: ago(14 * DAY), writesSince: 200, now })).toBe(false)
    expect(shouldRemindBackup({ lastBackupAt: ago(14 * DAY + 60_000), writesSince: 0, now })).toBe(true)
    expect(shouldRemindBackup({ lastBackupAt: ago(DAY), writesSince: 201, now })).toBe(true)
    expect(shouldRemindBackup({ lastBackupAt: null, writesSince: 200, now })).toBe(false)
    expect(shouldRemindBackup({ lastBackupAt: null, writesSince: 201, now })).toBe(true)
  })

  it('reminds once per session', () => {
    const reminder = createBackupReminder()
    const due = { lastBackupAt: ago(30 * DAY), writesSince: 0, now }
    expect(reminder.due({ ...due, writesSince: 0, lastBackupAt: ago(DAY) })).toBe(false)
    expect(reminder.due(due)).toBe(true)
    expect(reminder.due(due)).toBe(false)
    expect(reminder.due({ ...due, writesSince: 999 })).toBe(false)
  })

  it('says how long ago the last backup was', () => {
    expect(lastBackupAgo(null, now)).toEqual({ key: 'backup.lastNever' })
    expect(lastBackupAgo(ago(10 * 60_000), now)).toEqual({ key: 'backup.lastJustNow' })
    expect(lastBackupAgo(ago(5 * 3_600_000), now)).toEqual({ key: 'backup.lastHours', count: 5 })
    expect(lastBackupAgo(ago(12 * DAY + 3_600_000), now)).toEqual({ key: 'backup.lastDays', count: 12 })
  })
})

describe('device bookkeeping', () => {
  it('counts writes since the last backup per source; a new backup starts again from zero', async () => {
    const db = createMemoryDeviceDb()
    expect(await db.getBackupInfo('a')).toEqual({ lastBackupAt: null, writesSince: 0 })
    await Promise.all([db.countWrite('a'), db.countWrite('a'), db.countWrite('b')])
    expect(await db.getBackupInfo('a')).toEqual({ lastBackupAt: null, writesSince: 2 })
    await db.noteBackup('a', '2026-11-11T10:00:00.000Z')
    await db.countWrite('a')
    expect(await db.getBackupInfo('a')).toEqual({ lastBackupAt: '2026-11-11T10:00:00.000Z', writesSince: 1 })
    expect(await db.getBackupInfo('b')).toEqual({ lastBackupAt: null, writesSince: 1 })
    await db.deleteSource('a')
    expect(await db.getBackupInfo('a')).toEqual({ lastBackupAt: null, writesSince: 0 })
  })

  it('keeps the restore run of each backup file: one that did not finish into the same source in the same way goes on', async () => {
    const db = await openDeviceDb()
    expect(await db.getRestoreRun('sha-a')).toBeNull()
    const [a1, a2] = await Promise.all([db.beginRestoreRun('sha-a', 's1', 'new-ids'), db.beginRestoreRun('sha-a', 's1', 'new-ids')])
    expect(a1.resumed).toBe(false)
    expect(a2).toEqual({ run: a1.run, resumed: true })
    expect(a1.run).toMatchObject({ sourceId: 's1', mode: 'new-ids', finished: false })
    // Kept across a reload of the app.
    expect(await (await openDeviceDb()).getRestoreRun('sha-a')).toEqual(a1.run)
    // Into another source, or the other way: a new run.
    const other = await db.beginRestoreRun('sha-a', 's2', 'new-ids')
    expect(other.resumed).toBe(false)
    expect(other.run.runId).not.toBe(a1.run.runId)
    const same = await db.beginRestoreRun('sha-a', 's2', 'same-ids')
    expect(same.resumed).toBe(false)
    // Finished: running the file again is a new run (a fresh copy).
    await db.finishRestoreRun('sha-a', same.run.runId)
    expect(await db.getRestoreRun('sha-a')).toEqual({ ...same.run, finished: true })
    const fresh = await db.beginRestoreRun('sha-a', 's2', 'same-ids')
    expect(fresh.resumed).toBe(false)
    expect(fresh.run.runId).not.toBe(same.run.runId)
    // A run that wrote nothing is dropped; a stale id changes nothing.
    await db.finishRestoreRun('sha-a', same.run.runId)
    await db.dropRestoreRun('sha-a', same.run.runId)
    expect(await db.getRestoreRun('sha-a')).toEqual(fresh.run)
    await db.dropRestoreRun('sha-a', fresh.run.runId)
    expect(await db.getRestoreRun('sha-a')).toBeNull()
    // What an earlier build kept there (a bare run id) is no run.
    await set('restoreRun:sha-c', newId(), createStore('antresol', 'kv'))
    expect(await db.getRestoreRun('sha-c')).toBeNull()
    expect((await db.beginRestoreRun('sha-c', 's1', 'new-ids')).resumed).toBe(false)
  })

  it('fingerprints a file by its SHA-256', async () => {
    expect(await fingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('restoreChoice', () => {
  const run = (patch: object) => ({ runId: newId(), sourceId: 's1', mode: 'same-ids' as const, finished: false, ...patch })

  it('the same ids only into an empty source, or to go on with a run of this file into this source that did not finish', () => {
    expect(restoreChoice({ run: null, sourceId: 's1', sourceInventories: 0 })).toEqual({
      mode: 'same-ids', sameIdsAllowed: true, unfinished: false, restoredBefore: false,
    })
    expect(restoreChoice({ run: null, sourceId: 's1', sourceInventories: 2 })).toEqual({
      mode: 'new-ids', sameIdsAllowed: false, unfinished: false, restoredBefore: false,
    })
    expect(restoreChoice({ run: run({}), sourceId: 's1', sourceInventories: 2 })).toEqual({
      mode: 'same-ids', sameIdsAllowed: true, unfinished: true, restoredBefore: false,
    })
    // Another source's run, or a finished one, says nothing about this source's data.
    expect(restoreChoice({ run: run({ sourceId: 's2' }), sourceId: 's1', sourceInventories: 2 })).toMatchObject({
      mode: 'new-ids', sameIdsAllowed: false, unfinished: false,
    })
    expect(restoreChoice({ run: run({ finished: true }), sourceId: 's1', sourceInventories: 2 })).toEqual({
      mode: 'new-ids', sameIdsAllowed: false, unfinished: false, restoredBefore: true,
    })
    expect(restoreChoice({ run: run({ mode: 'new-ids' }), sourceId: 's1', sourceInventories: 2 })).toEqual({
      mode: 'new-ids', sameIdsAllowed: false, unfinished: true, restoredBefore: false,
    })
  })

  it('tells what a run actually added', () => {
    expect(restoreOutcome({ inventories: 3, rows: 50 })).toEqual({ key: 'backup.restored', count: 3 })
    expect(restoreOutcome({ inventories: 0, rows: 150 })).toEqual({ key: 'backup.restoredRows', count: 150 })
    expect(restoreOutcome({ inventories: 0, rows: 0 })).toEqual({ key: 'backup.restoredNothing', count: 0 })
  })
})

describe('workspace restore', () => {
  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
  const neon = (id: string): SourceConfig => ({
    id, kind: 'neon', name: `Source ${id}`, connectionString: `postgresql://u:pw@h/${id}`, uploadcarePublicKey: null,
    createdAt: '2026-11-10T00:00:00Z',
  })

  async function setup() {
    const execs = new Map<string, PgExecutor>()
    /** One-shot: the next write batch fails as a dropped connection does, before it reaches the database
     *  (`failNextBatch`) or after it committed (`dropAfterCommit`). */
    const flags = { failNextBatch: false, dropAfterCommit: false }
    for (const id of ['empty', 'full']) {
      const exec = (await emptyStorage()).exec
      execs.set(`postgresql://u:pw@h/${id}`, {
        ...exec,
        batch: async (statements) => {
          if (flags.failNextBatch) {
            flags.failNextBatch = false
            throw new StorageError('unavailable', 'connection dropped')
          }
          const rows = await exec.batch(statements)
          if (flags.dropAfterCommit) {
            flags.dropAfterCommit = false
            throw new StorageError('unavailable', 'connection dropped')
          }
          return rows
        },
        close: async () => {},
      })
    }
    const db = createMemoryDeviceDb()
    await db.putSource(neon('empty'))
    await db.putSource(neon('full'))
    const drivers = { neon: createNeonDriver((cs) => execs.get(cs)!) }
    /** The app opened again on this device's data (or another device's). */
    const reopen = async (on = db) => {
      const opened = createWorkspace({ db: on, drivers, userAgent: UA })
      await opened.start()
      return opened
    }
    const workspace = await reopen()
    const storageOf = async (id: string) => (await openPostgresStorage(execs.get(`postgresql://u:pw@h/${id}`)!)).storage
    return { workspace, db, flags, reopen, storageOf }
  }

  /** The demo backup with `count` more receipts in Electronics: more than one batch. */
  function bigger(backup: BackupFile, count: number): BackupFile {
    return {
      ...backup,
      inventories: backup.inventories.map((e) => {
        if (e.snapshot.inventory.name !== 'Electronics') return e
        const itemId = e.snapshot.items[0]!.id
        const extra: Movement[] = Array.from({ length: count }, (_, i) => ({
          id: newId(), seq: 100_000 + i, itemId, variantId: null, kind: 'receipt', quantity: '1' as Quantity, totalPrice: null,
          sourceUrl: null, note: null, transferId: null, createdAt: '2026-11-11T10:00:00.000Z', createdBy: 'Test',
        }))
        return { ...e, movements: [...e.movements, ...extra] }
      }),
    }
  }

  /** The source's inventories as the workspace lists them, archived ones included. */
  const inventoriesOf = (workspace: Workspace, sourceId: string) =>
    [...workspace.state.inventories, ...workspace.state.archivedInventories].filter((e) => e.ref.sourceId === sourceId)

  it('restores into an empty source with the same ids, then shows a restored inventory loaded in full', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { workspace } = await setup()
    const progress: number[] = []
    const { inventoryIds } = await workspace.restoreSource('empty', backup, 'same-ids', 'sha-1', (done) => progress.push(done))
    expect(inventoryIds).toEqual(backup.inventories.map((e) => e.snapshot.inventory.id))
    expect(progress.length).toBeGreaterThan(1)
    const { state } = workspace
    expect(state.inventories.filter((e) => e.ref.sourceId === 'empty').map((e) => e.inventory.name).sort()).toEqual(['Electronics', 'Workshop'])
    expect(state.archivedInventories.map((e) => e.inventory.name)).toEqual(['Archive test'])
    expect(state.current?.sourceId).toBe('empty')
    const shown = backup.inventories.find((e) => e.snapshot.inventory.id === state.current?.inventoryId)!
    expect(state.snapshot).toEqual(shown.snapshot)
    expect(state.snapshotOrigin).toBe('live')
  })

  it('as new inventories: a finished run of the same file, run again, is another copy; each says what it added', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { workspace } = await setup()
    const restored = await workspace.restoreSource('full', backup, 'same-ids', 'sha-1')
    expect(restored.added.inventories).toBe(3)
    const first = await workspace.restoreSource('full', backup, 'new-ids', 'sha-1')
    expect(first.added).toEqual(restored.added)
    expect(await workspace.restoreRun('sha-1')).toMatchObject({ sourceId: 'full', mode: 'new-ids', finished: true })
    const names = () => inventoriesOf(workspace, 'full').map((e) => e.inventory.name).sort()
    expect(names()).toEqual(['Archive test', 'Archive test', 'Electronics', 'Electronics', 'Workshop', 'Workshop'])
    expect(workspace.state.current).toEqual({ sourceId: 'full', inventoryId: first.inventoryIds.find((id) => workspace.state.inventories.some((e) => e.inventory.id === id))! })
    const again = await workspace.restoreSource('full', backup, 'new-ids', 'sha-1')
    expect(again.inventoryIds.filter((id) => first.inventoryIds.includes(id))).toEqual([])
    expect(again.added).toEqual(restored.added)
    expect(names()).toHaveLength(9)
  })

  it('refuses the same ids into a source that holds inventories; the device keeps no run of it to go on with', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { workspace } = await setup()
    await workspace.createInventory({ sourceId: 'empty', name: 'Live', currency: 'USD' })
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(workspace.restoreSource('empty', backup, 'same-ids', 'sha-1')).rejects.toMatchObject({ code: 'not_empty' })
      expect(await workspace.restoreRun('sha-1')).toBeNull()
    }
    expect(inventoriesOf(workspace, 'empty').map((e) => e.inventory.name)).toEqual(['Live'])
  })

  it('a same-ids restore cut off after a batch landed goes on with the same ids after a reload, and only on this device', async () => {
    const { file, storage: original } = await demoBackup()
    const backup = bigger(parseBackup(file) as BackupFile, 600)
    const { workspace, flags, reopen, storageOf } = await setup()
    flags.dropAfterCommit = true
    let total = 0
    await expect(workspace.restoreSource('empty', backup, 'same-ids', 'sha-1', (_, all) => (total = all))).rejects.toMatchObject({ code: 'unavailable' })
    expect(total).toBeGreaterThan(500)

    const reloaded = await reopen()
    const run = await reloaded.restoreRun('sha-1')
    expect(run).toMatchObject({ sourceId: 'empty', mode: 'same-ids', finished: false })
    const held = inventoriesOf(reloaded, 'empty').length
    expect(held).toBeGreaterThan(0)
    expect(restoreChoice({ run, sourceId: 'empty', sourceInventories: held })).toEqual({
      mode: 'same-ids', sameIdsAllowed: true, unfinished: true, restoredBefore: false,
    })
    // Another device knows of no such run: the source is not empty, so the same ids are refused there.
    const other = await reopen(await (async () => {
      const db = createMemoryDeviceDb()
      await db.putSource(neon('empty'))
      return db
    })())
    await expect(other.restoreSource('empty', backup, 'same-ids', 'sha-1')).rejects.toMatchObject({ code: 'not_empty' })

    const result = await reloaded.restoreSource('empty', backup, 'same-ids', 'sha-1')
    expect(result.added.rows).toBe(total - 500)
    expect(await reloaded.restoreRun('sha-1')).toMatchObject({ runId: run!.runId, finished: true })
    const storage = await storageOf('empty')
    for (const { snapshot, movements } of backup.inventories) {
      const id = snapshot.inventory.id
      const { stock: _stock, ...rows } = await storage.loadInventory(id)
      const { stock: _was, ...expected } = await original.loadInventory(id)
      expect(rows).toEqual(expected)
      expect((await storage.loadAllMovements(id)).map((m) => m.id).sort()).toEqual(movements.map((m) => m.id).sort())
    }
  })

  it('counts this device\'s writes since the last backup of the source', async () => {
    const { workspace } = await setup()
    const ref = await workspace.createInventory({ sourceId: 'empty', name: 'A', currency: 'USD' })
    await workspace.applyTo(ref, { type: 'folder.create', id: newId(), inventoryId: ref.inventoryId, parentId: null, name: 'F', description: null })
    expect(await workspace.backupInfo('empty')).toEqual({ lastBackupAt: null, writesSince: 2 })
    await workspace.noteBackup('empty')
    expect(await workspace.backupInfo('empty')).toMatchObject({ writesSince: 0 })
    expect((await workspace.backupInfo('empty')).lastBackupAt).not.toBeNull()
  })

  it('a new-ids restore cut off by the network rejects and reloads the source; run again, it adds the rest once', async () => {
    const { file } = await demoBackup()
    const backup = bigger(parseBackup(file) as BackupFile, 600)
    const { workspace, flags } = await setup()
    flags.failNextBatch = true
    await expect(workspace.restoreSource('empty', backup, 'new-ids', 'sha-1')).rejects.toMatchObject({ code: 'unavailable' })
    // The reload after the failed run reached the source again.
    expect(workspace.state.sources.find((s) => s.config.id === 'empty')!.status).toBe('ready')
    flags.dropAfterCommit = true
    let total = 0
    await expect(workspace.restoreSource('empty', backup, 'new-ids', 'sha-1', (_, all) => (total = all))).rejects.toMatchObject({ code: 'unavailable' })
    const rest = await workspace.restoreSource('empty', backup, 'new-ids', 'sha-1')
    expect(rest.added.rows).toBe(total - 500)
    const names = () => inventoriesOf(workspace, 'empty').map((e) => e.inventory.name).sort()
    expect(names()).toEqual(['Archive test', 'Electronics', 'Workshop'])
  })

  it('the backup reminder looks again after a stock write, which does not mark the app as saving', async () => {
    const { workspace, db } = await setup()
    const ref = await workspace.createInventory({ sourceId: 'empty', name: 'A', currency: 'USD' })
    const itemId = newId()
    await workspace.applyTo(ref, {
      type: 'item.create', id: itemId, inventoryId: ref.inventoryId, folderId: null, name: 'Wire', description: null, unitKey: 'pcs',
      tagIds: [], initialReceipt: null,
    })
    // Exactly at the threshold: not due yet.
    while ((await db.getBackupInfo('empty')).writesSince < 200) await db.countWrite('empty')
    const remind = vi.fn()
    const stop = watchBackupReminder(workspace, remind, () => new Date('2026-11-11T12:00:00Z'))
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(remind).not.toHaveBeenCalled()
      await workspace.applyTo(ref, {
        type: 'stock.receive', movementId: newId(), itemId, variantId: null, quantity: '1' as Quantity, totalPrice: null, sourceUrl: null,
        note: null,
      })
      expect(workspace.state.saving).toBe(false)
      await vi.waitFor(() => expect(remind).toHaveBeenCalledTimes(1))
      expect(remind.mock.calls[0]![0]).toMatchObject({ id: 'empty' })
      expect(remind.mock.calls[0]![1]).toMatchObject({ writesSince: 201 })
    } finally {
      stop()
    }
  })

  it('refuses a source that is not connected and writable', async () => {
    const { workspace } = await setup()
    await expect(workspace.restoreSource('missing', { inventories: [] } as unknown as BackupFile, 'same-ids', 'x')).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('shareOrDownload', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  const backup = buildBackup({ exportedAt: 't', app: { schemaVersion: 5 }, source: { name: 'Home', kind: 'neon' }, inventories: [] })
  const at = new Date('2026-11-11T00:00:00Z')

  function stubDownload() {
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click, remove: vi.fn() }), body: { append: vi.fn() } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    return click
  }

  it('shares the file on a touch device that can share files', async () => {
    const click = stubDownload()
    const share = vi.fn(async (_data: ShareData) => {})
    const result = await shareOrDownload(backup, at, { canShare: () => true, share, touch: true })
    expect(result).toBe('shared')
    const files = share.mock.calls[0]![0].files!
    expect(files[0]!.name).toBe('antresol-home-2026-11-11.json')
    expect(files[0]!.type).toBe('application/json')
    expect(click).not.toHaveBeenCalled()
  })

  it('does nothing more when the person closes the share sheet', async () => {
    const click = stubDownload()
    const share = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    expect(await shareOrDownload(backup, at, { canShare: () => true, share, touch: true })).toBe('cancelled')
    expect(click).not.toHaveBeenCalled()
  })

  it('downloads when sharing fails, cannot share files, or on a computer', async () => {
    const click = stubDownload()
    const failing = vi.fn(async () => {
      throw new DOMException('no activation', 'NotAllowedError')
    })
    expect(await shareOrDownload(backup, at, { canShare: () => true, share: failing, touch: true })).toBe('downloaded')
    expect(await shareOrDownload(backup, at, { canShare: () => false, share: failing, touch: true })).toBe('downloaded')
    expect(await shareOrDownload(backup, at, { share: failing, touch: true })).toBe('downloaded')
    const share = vi.fn(async () => {})
    expect(await shareOrDownload(backup, at, { canShare: () => true, share, touch: false })).toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledTimes(4)
  })
})
