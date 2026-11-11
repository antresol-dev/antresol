import { newId, type Inventory, type InventorySnapshot } from '@graymatter/core'
import { createStore, del, get, getMany, keys, set, setMany, update, type UseStore } from 'idb-keyval'
import type { AccentName } from './accent'
import type { InventoryRef, SourceConfig } from './types'
import type { CheckInterval } from './workspace-types'

export interface DeviceSettings {
  deviceName: string | null
  current: InventoryRef | null
  /** Absent until chosen: DEFAULT_CHECK_INTERVAL. */
  checkInterval?: CheckInterval
  /** Absent until chosen: DEFAULT_ACCENT. A value this app does not know (from a newer one) counts as absent. */
  accent?: AccentName
}

/** This device's backup bookkeeping for one source (the reminder and "Last backup" in settings). */
export interface BackupInfo {
  /** When this device last saved or shared a backup of the source; null: never. */
  lastBackupAt: string | null
  /** Writes this device made to the source since then. */
  writesSince: number
}

export interface CachedSnapshot {
  snapshot: InventorySnapshot
  savedAt: string
  /** Source revision the snapshot is known to be at least as new as; absent or null when unknown. */
  rev?: string | null
  /** The app's snapshot format and schema version when saved (see workspace.ts); a copy with another mark is not shown. */
  format?: string
}

/*
 * A cached copy's revision lives under its own key next to the snapshot, so it can be moved or cleared without
 * rewriting the snapshot. `putSnapshot` writes both in one transaction. The `rev` inside the record is what the copy
 * was saved with, the only revision a copy saved by an older app has; it is read when the revision key is missing.
 * Every revision kept for a copy is one its rows are at least as new as.
 */

export interface DeviceDb {
  readonly persistent: boolean
  getSources(): Promise<SourceConfig[]>
  /** Insert or replace by id. */
  putSource(s: SourceConfig): Promise<void>
  /** Also deletes this source's cached snapshots. */
  deleteSource(id: string): Promise<void>
  getSettings(): Promise<DeviceSettings>
  putSettings(patch: Partial<DeviceSettings>): Promise<void>
  getSnapshot(ref: InventoryRef): Promise<CachedSnapshot | null>
  /** The snapshot and its revision, together. */
  putSnapshot(ref: InventoryRef, value: CachedSnapshot): Promise<void>
  deleteSnapshot(ref: InventoryRef): Promise<void>
  /** Every cached copy of the source except `exceptInventoryId` that is at revision `from` is now at `to`: the source
   *  moved from `from` to `to` by one write to `exceptInventoryId`. Copies at another or an unknown revision keep it. */
  advanceSnapshotRevs(sourceId: string, from: string, to: string, exceptInventoryId: string): Promise<void>
  /** The copy's revision becomes unknown; its rows stay. */
  markSnapshotStale(ref: InventoryRef): Promise<void>
  /** A source's last known inventories, active and archived; replaces the stored list. */
  putListing(sourceId: string, inventories: Inventory[]): Promise<void>
  /** Stored lists by source id. */
  getListings(): Promise<Record<string, Inventory[]>>
  deleteListing(sourceId: string): Promise<void>
  getBackupInfo(sourceId: string): Promise<BackupInfo>
  /** A backup of the source was saved or shared `at`: the write count starts again from zero. */
  noteBackup(sourceId: string, at: string): Promise<void>
  /** One more write to the source since its last backup. */
  countWrite(sourceId: string): Promise<void>
  /** The id of the restore run for a backup file, by the file's SHA-256: made on first use, then always the same, so a
   *  restore of the same file with new ids gets the same ids every time it is run (nothing is added twice). */
  restoreRunId(fileSha256: string): Promise<string>
}

const SOURCES = 'sources'
const SETTINGS = 'settings'
const LISTINGS = 'listings'
const snapshotKey = (ref: InventoryRef): string => `snapshot:${ref.sourceId}:${ref.inventoryId}`
const snapshotPrefix = (sourceId: string): string => `snapshot:${sourceId}:`
const revKey = (ref: InventoryRef): string => `snapshotRev:${ref.sourceId}:${ref.inventoryId}`
const revPrefix = (sourceId: string): string => `snapshotRev:${sourceId}:`
const backupKey = (sourceId: string): string => `backup:${sourceId}`
const runKey = (fileSha256: string): string => `restoreRun:${fileSha256}`
const noBackup = (): BackupInfo => ({ lastBackupAt: null, writesSince: 0 })
const defaultSettings = (): DeviceSettings => ({ deviceName: null, current: null })

function upsertSource(list: SourceConfig[] | undefined, s: SourceConfig): SourceConfig[] {
  const rest = (list ?? []).filter((x) => x.id !== s.id)
  return [...rest, s]
}

/** Minimal async key-value backend shared by the IndexedDB and in-memory implementations. */
interface Kv {
  get<T>(key: string): Promise<T | undefined>
  /** One read transaction. */
  getMany(keys: string[]): Promise<unknown[]>
  set(key: string, value: unknown): Promise<void>
  /** One write transaction. */
  setMany(entries: [string, unknown][]): Promise<void>
  update<T>(key: string, fn: (v: T | undefined) => T): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
}

function buildDeviceDb(kv: Kv, persistent: boolean): DeviceDb {
  return {
    persistent,
    async getSources() {
      return (await kv.get<SourceConfig[]>(SOURCES)) ?? []
    },
    async putSource(s) {
      await kv.update<SourceConfig[]>(SOURCES, (list) => upsertSource(list, s))
    },
    async deleteSource(id) {
      await kv.update<SourceConfig[]>(SOURCES, (list) => (list ?? []).filter((x) => x.id !== id))
      const prefixes = [snapshotPrefix(id), revPrefix(id)]
      for (const key of await kv.keys()) {
        if (prefixes.some((p) => key.startsWith(p))) await kv.del(key)
      }
      await kv.del(backupKey(id))
    },
    async getSettings() {
      return { ...defaultSettings(), ...(await kv.get<Partial<DeviceSettings>>(SETTINGS)) }
    },
    async putSettings(patch) {
      await kv.update<Partial<DeviceSettings>>(SETTINGS, (cur) => ({ ...defaultSettings(), ...cur, ...patch }))
    },
    async getSnapshot(ref) {
      const [value, rev] = (await kv.getMany([snapshotKey(ref), revKey(ref)])) as [
        CachedSnapshot | undefined,
        string | null | undefined,
      ]
      if (!value) return null
      return rev === undefined ? value : { ...value, rev }
    },
    async putSnapshot(ref, value) {
      await kv.setMany([
        [snapshotKey(ref), value],
        [revKey(ref), value.rev ?? null],
      ])
    },
    async deleteSnapshot(ref) {
      // The snapshot first: a revision key without its snapshot is never read.
      await kv.del(snapshotKey(ref))
      await kv.del(revKey(ref))
    },
    async advanceSnapshotRevs(sourceId, from, to, exceptInventoryId) {
      const prefix = snapshotPrefix(sourceId)
      for (const key of await kv.keys()) {
        if (!key.startsWith(prefix)) continue
        const ref = { sourceId, inventoryId: key.slice(prefix.length) }
        if (ref.inventoryId === exceptInventoryId) continue
        const stored = await kv.get<string | null>(revKey(ref))
        // Leaving a revision as it is is always safe: at worst the copy is loaded again.
        if (stored !== undefined && stored !== from) continue
        // A copy saved by an older app keeps its revision inside the record: read it once, it moves to its own key.
        const legacy = stored === undefined ? ((await kv.get<CachedSnapshot>(key))?.rev ?? null) : null
        // Atomic on the revision key; `putSnapshot` writes that key with the snapshot.
        await kv.update<string | null>(revKey(ref), (rev) => {
          const current = rev === undefined ? legacy : rev
          return current === from ? to : current
        })
      }
    },
    async markSnapshotStale(ref) {
      await kv.set(revKey(ref), null)
    },
    async putListing(sourceId, inventories) {
      await kv.update<Record<string, Inventory[]>>(LISTINGS, (all) => ({ ...all, [sourceId]: inventories }))
    },
    async getListings() {
      return (await kv.get<Record<string, Inventory[]>>(LISTINGS)) ?? {}
    },
    async deleteListing(sourceId) {
      await kv.update<Record<string, Inventory[]>>(LISTINGS, (all) =>
        Object.fromEntries(Object.entries(all ?? {}).filter(([id]) => id !== sourceId)),
      )
    },
    async getBackupInfo(sourceId) {
      return { ...noBackup(), ...(await kv.get<BackupInfo>(backupKey(sourceId))) }
    },
    async noteBackup(sourceId, at) {
      await kv.set(backupKey(sourceId), { lastBackupAt: at, writesSince: 0 })
    },
    async countWrite(sourceId) {
      await kv.update<BackupInfo>(backupKey(sourceId), (info) => {
        const base = { ...noBackup(), ...info }
        return { ...base, writesSince: base.writesSince + 1 }
      })
    },
    async restoreRunId(fileSha256) {
      // Atomic: two calls for one file agree on the id.
      await kv.update<string>(runKey(fileSha256), (id) => id ?? newId())
      return (await kv.get<string>(runKey(fileSha256)))!
    },
  }
}

function idbKv(store: UseStore): Kv {
  return {
    get: (key) => get(key, store),
    getMany: (keys) => getMany(keys, store),
    set: (key, value) => set(key, value, store),
    setMany: (entries) => setMany(entries, store),
    update: (key, fn) => update(key, fn, store),
    del: (key) => del(key, store),
    keys: async () => (await keys(store)).map(String),
  }
}

function memoryKv(): Kv {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    getMany: async (keys) => keys.map((key) => map.get(key)),
    set: async (key, value) => {
      map.set(key, value)
    },
    setMany: async (entries) => {
      for (const [key, value] of entries) map.set(key, value)
    },
    update: async <T>(key: string, fn: (v: T | undefined) => T) => {
      map.set(key, fn(map.get(key) as T | undefined))
    },
    del: async (key) => {
      map.delete(key)
    },
    keys: async () => [...map.keys()],
  }
}

export function createMemoryDeviceDb(): DeviceDb {
  return buildDeviceDb(memoryKv(), false)
}

/** IndexedDB (idb-keyval store 'graymatter'/'kv'); falls back to memory when IndexedDB is missing or unusable. */
export async function openDeviceDb(): Promise<DeviceDb> {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return createMemoryDeviceDb()
    const kv = idbKv(createStore('graymatter', 'kv'))
    await kv.set('__probe', 1)
    await kv.del('__probe')
    void requestPersistence()
    return buildDeviceDb(kv, true)
  } catch {
    return createMemoryDeviceDb()
  }
}

async function requestPersistence(): Promise<void> {
  try {
    await navigator.storage?.persist?.()
  } catch {
    // best-effort only
  }
}
