import { parseQuantity, type InventoryExport, type InventorySnapshot, type Movement } from '@graymatter/core'
import { APP_SCHEMA_VERSION } from '@graymatter/storage-postgres'

export interface BackupFile {
  format: 'graymatter-backup'
  version: 1
  exportedAt: string
  app: { schemaVersion: number }
  /** Name and type only: never the connection string or any key. */
  source: { name: string; kind: string }
  /** Every inventory of the source, archived ones included; movements oldest first. */
  inventories: { snapshot: InventorySnapshot; movements: Movement[] }[]
}

export function buildBackup(input: Omit<BackupFile, 'format' | 'version'>): BackupFile {
  return {
    format: 'graymatter-backup',
    version: 1,
    exportedAt: input.exportedAt,
    app: { schemaVersion: input.app.schemaVersion },
    // Rebuilt field by field: whatever else the caller's source object carries stays out of the file.
    source: { name: input.source.name, kind: input.source.kind },
    inventories: input.inventories,
  }
}

/** 'graymatter-<slug>-2026-11-11.json' (the date is UTC). */
export function backupFileName(sourceName: string, at: Date): string {
  const slug = sourceName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `graymatter-${slug || 'source'}-${at.toISOString().slice(0, 10)}.json`
}

export const REVOKE_DELAY_MS = 10_000

const backupJson = (backup: BackupFile): string => JSON.stringify(backup, null, 2)

/** Saves the backup through a temporary link; the object URL is revoked afterwards. */
export function downloadBackup(backup: BackupFile, at: Date): void {
  const url = URL.createObjectURL(new Blob([backupJson(backup)], { type: 'application/json' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(backup.source.name, at)
    document.body.append(a)
    a.click()
    a.remove()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  // Safari and some Firefox versions start the download after click() returns: revoke later.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

export interface ShareEnv {
  canShare?: (data: ShareData) => boolean
  share?: (data: ShareData) => Promise<void>
  /** A phone or tablet (coarse primary pointer): the share sheet (Drive, Telegram) suits it; a computer downloads. */
  touch: boolean
}

function browserShareEnv(): ShareEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    canShare: nav?.canShare?.bind(nav),
    share: nav?.share?.bind(nav),
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  }
}

/**
 * On a phone: the system share sheet with the file (Drive, Telegram…). Closed by the person: 'cancelled', nothing else
 * happens. Anywhere else, or when the sheet cannot open (no file sharing, or the tap that started the export is too long
 * ago for the browser): the usual download.
 */
export async function shareOrDownload(
  backup: BackupFile,
  at: Date,
  env: ShareEnv = browserShareEnv(),
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (env.touch && env.share && env.canShare) {
    const file = new File([backupJson(backup)], backupFileName(backup.source.name, at), { type: 'application/json' })
    const data: ShareData = { files: [file], title: file.name }
    let can = false
    try {
      can = env.canShare(data)
    } catch {
      // Treated as "cannot".
    }
    if (can) {
      try {
        await env.share(data)
        return 'shared'
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return 'cancelled'
        // Not allowed or failed: the download below.
      }
    }
  }
  downloadBackup(backup, at)
  return 'downloaded'
}

/** SHA-256 of the file's text, hex: the same file always gives the same restore run (see DeviceDb.restoreRunId). */
export async function fingerprint(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- reading a file back ----

export type BackupProblem = 'format' | 'version' | 'newer_schema'

type Check = (value: unknown) => boolean

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str: Check = (v) => typeof v === 'string'
const uuid: Check = (v) => typeof v === 'string' && UUID.test(v)
const time: Check = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v))
const int: Check = (v) => Number.isSafeInteger(v)
const bool: Check = (v) => typeof v === 'boolean'
const quantity: Check = (v) => typeof v === 'string' && parseQuantity(v) === v
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v)
const oneOf =
  (...values: string[]): Check =>
  (v) =>
    typeof v === 'string' && values.includes(v)
const listOf =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check)

type Shape = Record<string, Check>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The fields of `shape`, checked, in a new object: anything else the file carries is left behind. `defaults`: fields
 * that a file of an older schema does not have yet, with the value the database gave them when they were added.
 */
function record<T>(value: unknown, shape: Shape, defaults: Record<string, unknown> = {}): T | null {
  if (!isRecord(value)) return null
  const out: Record<string, unknown> = {}
  for (const [key, check] of Object.entries(shape)) {
    const v = Object.hasOwn(value, key) ? value[key] : defaults[key]
    if (!check(v)) return null
    out[key] = v
  }
  return out as T
}

function records<T>(value: unknown, shape: Shape, defaults?: Record<string, unknown>): T[] | null {
  if (!Array.isArray(value)) return null
  const out: T[] = []
  for (const item of value) {
    const r = record<T>(item, shape, defaults)
    if (r === null) return null
    out.push(r)
  }
  return out
}

const AUDIT: Shape = { createdAt: time, updatedAt: time, createdBy: str, updatedBy: str }
const ARCHIVE: Shape = { archivedAt: nullable(time), archiveId: nullable(uuid) }

const SHAPES = {
  inventory: { id: uuid, name: str, description: nullable(str), currency: str, ...AUDIT, ...ARCHIVE },
  folder: { id: uuid, inventoryId: uuid, parentId: nullable(uuid), name: str, description: nullable(str), ...AUDIT, ...ARCHIVE },
  item: {
    id: uuid, inventoryId: uuid, folderId: nullable(uuid), name: str, description: nullable(str), unitKey: str,
    tagIds: listOf(uuid), ...AUDIT, ...ARCHIVE,
  },
  variant: { id: uuid, itemId: uuid, description: nullable(str), position: int, ...AUDIT, ...ARCHIVE },
  tag: { id: uuid, inventoryId: uuid, name: str, ...AUDIT },
  attribute: {
    id: uuid, inventoryId: uuid, name: str, kind: oneOf('text', 'enum', 'number'), options: listOf(str), unit: str,
    siPrefixes: bool, pinned: bool, ...AUDIT,
  },
  unit: { id: uuid, inventoryId: uuid, name: str, symbol: str, prefixPowers: listOf(int), ...AUDIT },
  itemAttribute: { itemId: uuid, attributeId: uuid, value: nullable(str), axisPosition: nullable(int) },
  variantAttributeValue: { variantId: uuid, attributeId: uuid, value: nullable(str) },
  photo: {
    id: uuid, itemId: uuid, variantId: nullable(uuid), provider: str, fileId: str, url: str, position: int,
    createdAt: time, createdBy: str,
  },
  stock: {
    itemId: uuid, variantId: nullable(uuid), quantity, pricedQuantity: quantity, pricedTotal: int,
    lastPriced: nullable((v) => record(v, { totalPrice: int, quantity, at: time }) !== null),
    lastCountedAt: nullable(time),
  },
  movement: {
    id: uuid, seq: int, itemId: uuid, variantId: nullable(uuid),
    kind: oneOf('receipt', 'usage', 'return', 'adjustment', 'transfer'), quantity, totalPrice: nullable(int),
    sourceUrl: nullable(str), note: nullable(str), transferId: nullable(uuid), createdAt: time, createdBy: str,
  },
} satisfies Record<string, Shape>

/** Fields newer than schema 3 (`pinned`: schema 4; `lastCountedAt`: Plan 8), absent from older files. */
const ATTRIBUTE_DEFAULTS = { pinned: false }
const STOCK_DEFAULTS = { lastCountedAt: null }

function inventoryExport(value: unknown): InventoryExport | null {
  if (!isRecord(value) || !isRecord(value.snapshot)) return null
  const s = value.snapshot
  const snapshot = {
    inventory: record(s.inventory, SHAPES.inventory),
    folders: records(s.folders, SHAPES.folder),
    items: records(s.items, SHAPES.item),
    variants: records(s.variants, SHAPES.variant),
    tags: records(s.tags, SHAPES.tag),
    attributes: records(s.attributes, SHAPES.attribute, ATTRIBUTE_DEFAULTS),
    units: records(s.units, SHAPES.unit),
    itemAttributes: records(s.itemAttributes, SHAPES.itemAttribute),
    variantAttributeValues: records(s.variantAttributeValues, SHAPES.variantAttributeValue),
    photos: records(s.photos, SHAPES.photo),
    stock: records(s.stock, SHAPES.stock, STOCK_DEFAULTS),
  }
  const movements = records<Movement>(value.movements, SHAPES.movement)
  if (movements === null || Object.values(snapshot).some((part) => part === null)) return null
  return { snapshot: snapshot as unknown as InventorySnapshot, movements }
}

/**
 * A file's JSON as a backup, every record checked field by field (nothing it does not know is kept), or why not:
 * `format` (not a GrayMatter backup, or damaged), `version` (a file format this app does not know), `newer_schema` (made
 * by a newer GrayMatter: its data may not fit this app's schema). Whether every reference resolves is checked when it is
 * restored (InventoryStorage.restore), before anything is written.
 */
export function parseBackup(json: unknown): BackupFile | { error: BackupProblem } {
  if (!isRecord(json) || json.format !== 'graymatter-backup') return { error: 'format' }
  if (json.version !== 1) return { error: 'version' }
  const app = record<{ schemaVersion: number }>(json.app, { schemaVersion: int })
  if (!app) return { error: 'format' }
  if (app.schemaVersion > APP_SCHEMA_VERSION) return { error: 'newer_schema' }
  const source = record<{ name: string; kind: string }>(json.source, { name: str, kind: str })
  if (!source || !time(json.exportedAt) || !Array.isArray(json.inventories)) return { error: 'format' }
  const inventories: InventoryExport[] = []
  for (const entry of json.inventories) {
    const parsed = inventoryExport(entry)
    if (!parsed) return { error: 'format' }
    inventories.push(parsed)
  }
  return buildBackup({ exportedAt: json.exportedAt as string, app, source, inventories })
}

/** The backup with each inventory renamed (restored as new ones, they are told apart from the originals). */
export function withInventoryNames(backup: BackupFile, rename: (name: string) => string): BackupFile {
  return {
    ...backup,
    inventories: backup.inventories.map((e) => ({
      ...e,
      snapshot: { ...e.snapshot, inventory: { ...e.snapshot.inventory, name: rename(e.snapshot.inventory.name) } },
    })),
  }
}

/** What the restore sheet shows before anything is written. */
export function backupSummary(backup: BackupFile): { inventories: number; items: number; movements: number } {
  return {
    inventories: backup.inventories.length,
    items: backup.inventories.reduce((n, e) => n + e.snapshot.items.length, 0),
    movements: backup.inventories.reduce((n, e) => n + e.movements.length, 0),
  }
}

// ---- reminder ----

export const REMIND_AFTER_DAYS = 14
export const REMIND_AFTER_WRITES = 200
const DAY_MS = 86_400_000

/** Due when the last backup (null: none known) is more than 14 days old, or this device wrote more than 200 times since. */
export function shouldRemindBackup(input: { lastBackupAt: string | null; writesSince: number; now: Date }): boolean {
  if (input.writesSince > REMIND_AFTER_WRITES) return true
  if (input.lastBackupAt === null) return false
  return input.now.getTime() - Date.parse(input.lastBackupAt) > REMIND_AFTER_DAYS * DAY_MS
}

/** At most one reminder per session (the page's lifetime): `due` answers true once, the first time it is due. */
export function createBackupReminder(): { due(input: Parameters<typeof shouldRemindBackup>[0]): boolean } {
  let shown = false
  return {
    due(input) {
      if (shown || !shouldRemindBackup(input)) return false
      shown = true
      return true
    },
  }
}

export type LastBackup =
  | { key: 'backup.lastNever' | 'backup.lastJustNow' }
  | { key: 'backup.lastHours' | 'backup.lastDays'; count: number }

/** "Last backup: 12 days ago": just now under an hour, then hours, then days, rounded down. */
export function lastBackupAgo(iso: string | null, now: Date): LastBackup {
  if (iso === null) return { key: 'backup.lastNever' }
  const hours = Math.floor(Math.max(0, now.getTime() - Date.parse(iso)) / 3_600_000)
  if (hours < 1) return { key: 'backup.lastJustNow' }
  if (hours < 24) return { key: 'backup.lastHours', count: hours }
  return { key: 'backup.lastDays', count: Math.floor(hours / 24) }
}
