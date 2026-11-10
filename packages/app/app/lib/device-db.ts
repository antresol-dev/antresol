import type { Inventory, InventorySnapshot } from '@graymatter/core'
import { createStore, del, get, keys, set, update, type UseStore } from 'idb-keyval'
import type { InventoryRef, SourceConfig } from './types'

export interface DeviceSettings {
  deviceName: string | null
  current: InventoryRef | null
}

export interface CachedSnapshot {
  snapshot: InventorySnapshot
  savedAt: string
}

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
  putSnapshot(ref: InventoryRef, value: CachedSnapshot): Promise<void>
  deleteSnapshot(ref: InventoryRef): Promise<void>
  /** A source's last known inventories, active and archived; replaces the stored list. */
  putListing(sourceId: string, inventories: Inventory[]): Promise<void>
  /** Stored lists by source id. */
  getListings(): Promise<Record<string, Inventory[]>>
  deleteListing(sourceId: string): Promise<void>
}

const SOURCES = 'sources'
const SETTINGS = 'settings'
const LISTINGS = 'listings'
const snapshotKey = (ref: InventoryRef): string => `snapshot:${ref.sourceId}:${ref.inventoryId}`
const snapshotPrefix = (sourceId: string): string => `snapshot:${sourceId}:`
const defaultSettings = (): DeviceSettings => ({ deviceName: null, current: null })

function upsertSource(list: SourceConfig[] | undefined, s: SourceConfig): SourceConfig[] {
  const rest = (list ?? []).filter((x) => x.id !== s.id)
  return [...rest, s]
}

/** Minimal async key-value backend shared by the IndexedDB and in-memory implementations. */
interface Kv {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
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
      const prefix = snapshotPrefix(id)
      for (const key of await kv.keys()) {
        if (key.startsWith(prefix)) await kv.del(key)
      }
    },
    async getSettings() {
      return { ...defaultSettings(), ...(await kv.get<Partial<DeviceSettings>>(SETTINGS)) }
    },
    async putSettings(patch) {
      await kv.update<Partial<DeviceSettings>>(SETTINGS, (cur) => ({ ...defaultSettings(), ...cur, ...patch }))
    },
    async getSnapshot(ref) {
      return (await kv.get<CachedSnapshot>(snapshotKey(ref))) ?? null
    },
    async putSnapshot(ref, value) {
      await kv.set(snapshotKey(ref), value)
    },
    async deleteSnapshot(ref) {
      await kv.del(snapshotKey(ref))
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
  }
}

function idbKv(store: UseStore): Kv {
  return {
    get: (key) => get(key, store),
    set: (key, value) => set(key, value, store),
    update: (key, fn) => update(key, fn, store),
    del: (key) => del(key, store),
    keys: async () => (await keys(store)).map(String),
  }
}

function memoryKv(): Kv {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => {
      map.set(key, value)
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
