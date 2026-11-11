import { PGlite } from '@electric-sql/pglite'
import { newId, StorageError, type InventoryStorage, type Movement } from '@graymatter/core'
import { APP_SCHEMA_VERSION, createPgliteExecutor, openPostgresStorage, type PgExecutor } from '@graymatter/storage-postgres'
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
  REVOKE_DELAY_MS,
  shareOrDownload,
  shouldRemindBackup,
  withInventoryNames,
  type BackupFile,
} from '../app/lib/backup'
import { createMemoryDeviceDb, openDeviceDb } from '../app/lib/device-db'
import { createDemoDriver, type DemoDriver } from '../app/lib/dev/demo-source'
import { createNeonDriver } from '../app/lib/sources'
import type { SourceConfig } from '../app/lib/types'
import { createWorkspace } from '../app/lib/workspace'

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
    expect(backup).toMatchObject({ format: 'graymatter-backup', version: 1, source: { name: 'Home', kind: 'neon' } })
    expect(Object.keys(backup.source)).toEqual(['name', 'kind'])
  })

  it('names the file from a slug of the source name', () => {
    const at = new Date('2026-11-11T10:00:00Z')
    expect(backupFileName('My Garage / #1!', at)).toBe('graymatter-my-garage-1-2026-11-11.json')
    expect(backupFileName('Demo', at)).toBe('graymatter-demo-2026-11-11.json')
    expect(backupFileName('???', at)).toBe('graymatter-source-2026-11-11.json')
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
    expect(link.download).toBe('graymatter-home-2026-11-11.json')
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

  it('refuses what is not a GrayMatter backup', () => {
    const ok = buildBackup({ exportedAt: '2026-11-11T10:00:00Z', app: { schemaVersion: 4 }, source: { name: 'H', kind: 'neon' }, inventories: [] })
    expect(parseBackup(JSON.parse(JSON.stringify(ok)))).toEqual(ok)
    for (const bad of [null, 'text', [], {}, { ...ok, format: 'other' }, { ...ok, inventories: {} }, { ...ok, exportedAt: 'soon' }]) {
      expect(parseBackup(bad), JSON.stringify(bad)).toEqual({ error: 'format' })
    }
  })

  it('tells an unknown file version and a newer schema apart', () => {
    const ok = buildBackup({ exportedAt: '2026-11-11T10:00:00Z', app: { schemaVersion: 4 }, source: { name: 'H', kind: 'neon' }, inventories: [] })
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

  it('keeps one restore run id per backup file fingerprint', async () => {
    const db = await openDeviceDb()
    const [a1, a2, b] = await Promise.all([db.restoreRunId('sha-a'), db.restoreRunId('sha-a'), db.restoreRunId('sha-b')])
    expect(a1).toBe(a2)
    expect(b).not.toBe(a1)
    expect(await (await openDeviceDb()).restoreRunId('sha-a')).toBe(a1)
  })

  it('fingerprints a file by its SHA-256', async () => {
    expect(await fingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
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
    /** One-shot: the next write batch fails as a dropped connection does. */
    const flags = { failNextBatch: false }
    for (const id of ['empty', 'full']) {
      const exec = (await emptyStorage()).exec
      execs.set(`postgresql://u:pw@h/${id}`, {
        ...exec,
        batch: async (statements) => {
          if (flags.failNextBatch) {
            flags.failNextBatch = false
            throw new StorageError('unavailable', 'connection dropped')
          }
          return exec.batch(statements)
        },
        close: async () => {},
      })
    }
    const db = createMemoryDeviceDb()
    await db.putSource(neon('empty'))
    await db.putSource(neon('full'))
    const workspace = createWorkspace({ db, drivers: { neon: createNeonDriver((cs) => execs.get(cs)!) }, userAgent: UA })
    await workspace.start()
    return { workspace, db, flags }
  }

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

  it('as new inventories: the same file twice adds nothing twice; another file is another run', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { workspace } = await setup()
    await workspace.restoreSource('full', backup, 'same-ids', 'sha-1')
    const first = await workspace.restoreSource('full', backup, 'new-ids', 'sha-1')
    const again = await workspace.restoreSource('full', backup, 'new-ids', 'sha-1')
    expect(again.inventoryIds).toEqual(first.inventoryIds)
    const names = () => [...workspace.state.inventories, ...workspace.state.archivedInventories]
      .filter((e) => e.ref.sourceId === 'full').map((e) => e.inventory.name).sort()
    expect(names()).toEqual(['Archive test', 'Archive test', 'Electronics', 'Electronics', 'Workshop', 'Workshop'])
    expect(workspace.state.current).toEqual({ sourceId: 'full', inventoryId: first.inventoryIds.find((id) => workspace.state.inventories.some((e) => e.inventory.id === id))! })
    await workspace.restoreSource('full', backup, 'new-ids', 'sha-2')
    expect(names()).toHaveLength(9)
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

  it('a restore cut off by the network rejects and reloads the source; the same file run again restores everything once', async () => {
    const { file } = await demoBackup()
    const backup = parseBackup(file) as BackupFile
    const { workspace, flags } = await setup()
    flags.failNextBatch = true
    await expect(workspace.restoreSource('empty', backup, 'new-ids', 'sha-1')).rejects.toMatchObject({ code: 'unavailable' })
    // The reload after the failed run reached the source again.
    expect(workspace.state.sources.find((s) => s.config.id === 'empty')!.status).toBe('ready')
    await workspace.restoreSource('empty', backup, 'new-ids', 'sha-1')
    await workspace.restoreSource('empty', backup, 'new-ids', 'sha-1')
    const restored = [...workspace.state.inventories, ...workspace.state.archivedInventories].filter((e) => e.ref.sourceId === 'empty')
    expect(restored.map((e) => e.inventory.name).sort()).toEqual(['Archive test', 'Electronics', 'Workshop'])
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
  const backup = buildBackup({ exportedAt: 't', app: { schemaVersion: 4 }, source: { name: 'Home', kind: 'neon' }, inventories: [] })
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
    expect(files[0]!.name).toBe('graymatter-home-2026-11-11.json')
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
