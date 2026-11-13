import {
  isDeleteHandle,
  isPhotoSide,
  MAX_RENDITIONS,
  normalizeRenditions,
  parseQuantity,
  parseRendition,
  type InventoryExport,
  type InventorySnapshot,
  type Movement,
  type Photo,
  type RestoreMode,
} from '@antresol/core'
import { APP_SCHEMA_VERSION, backupProblems, SCHEMA_BASE } from '@antresol/storage-postgres'
import { computed, watch, type WatchStopHandle } from 'vue'
import type { BackupInfo, RestoreRun } from './device-db'
import type { SourceConfig } from './types'
import type { Workspace } from './workspace-types'

export interface BackupFile {
  format: 'antresol-backup'
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
    format: 'antresol-backup',
    version: 1,
    exportedAt: input.exportedAt,
    app: { schemaVersion: input.app.schemaVersion },
    // Rebuilt field by field: whatever else the caller's source object carries stays out of the file.
    source: { name: input.source.name, kind: input.source.kind },
    inventories: input.inventories,
  }
}

/** 'antresol-<slug>-2026-11-11.json' (the date is UTC). */
export function backupFileName(sourceName: string, at: Date): string {
  const slug = sourceName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `antresol-${slug || 'source'}-${at.toISOString().slice(0, 10)}.json`
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

/** `prerelease`: made by a pre-release Antresol, whose data no longer fits the schema. */
export type BackupProblem = 'format' | 'version' | 'newer_schema' | 'prerelease'

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

/** 1 to MAX_RENDITIONS renditions, each one core's parseRendition reads (the check of a photo command): a rendition it
 *  does not read fails the file. The photo keeps them as parsed (see `photos`). */
const renditions: Check = (v) =>
  Array.isArray(v) && v.length >= 1 && v.length <= MAX_RENDITIONS && v.every((r) => parseRendition(r) !== null)

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
    createdAt: time, createdBy: str, urls: nullable(renditions), width: nullable(isPhotoSide), height: nullable(isPhotoSide),
    deleteHandle: nullable(isDeleteHandle),
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
/** Schema 5 added renditions, size and delete handle to photos: a file of schema 4 or older has none. */
const PHOTO_DEFAULTS = { urls: null, width: null, height: null, deleteHandle: null }

/** The photos of a file, each rendition rebuilt as parseRendition reads it: a key it does not know is left behind, as
 *  for every record, and `type` absent is null. */
function photos(value: unknown): Photo[] | null {
  const list = records<Photo>(value, SHAPES.photo, PHOTO_DEFAULTS)
  return list && list.map((p) => ({ ...p, urls: normalizeRenditions(p.urls) }))
}

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
    photos: photos(s.photos),
    stock: records(s.stock, SHAPES.stock, STOCK_DEFAULTS),
  }
  const movements = records<Movement>(value.movements, SHAPES.movement)
  if (movements === null || Object.values(snapshot).some((part) => part === null)) return null
  return { snapshot: snapshot as unknown as InventorySnapshot, movements }
}

/** The last schema whose files may come from a pre-release build: variants with names, item attributes without an
 *  axis position, attributes without the number kind's fields (before Plan 7). Older schemas are all pre-release. */
const LAST_PRE_RELEASE_SCHEMA = SCHEMA_BASE + 1

/** Raw inventories of a file in the shape of a pre-release build (see LAST_PRE_RELEASE_SCHEMA). */
function preReleaseShape(inventories: unknown[]): boolean {
  const any = (list: unknown, test: (r: Record<string, unknown>) => boolean): boolean =>
    Array.isArray(list) && list.some((r) => isRecord(r) && test(r))
  return inventories.some((entry) => {
    const s = isRecord(entry) && isRecord(entry.snapshot) ? entry.snapshot : null
    return (
      s !== null &&
      (any(s.variants, (v) => Object.hasOwn(v, 'name')) ||
        any(s.itemAttributes, (r) => !Object.hasOwn(r, 'axisPosition')) ||
        any(s.attributes, (a) => !Object.hasOwn(a, 'siPrefixes')))
    )
  })
}

/**
 * A file's JSON as a backup, every record checked field by field (nothing it does not know is kept), or why not:
 * `format` (not a Antresol backup, or damaged; `reason` says what, when it is more than a field's shape),
 * `version` (a file format this app does not know), `newer_schema` (made by a newer Antresol: its data may not fit
 * this app's schema), `prerelease` (made by a pre-release Antresol). Every reference must resolve inside its
 * inventory and every value fit the schema (backupProblems), as the restore checks again before writing anything.
 */
export function parseBackup(json: unknown): BackupFile | { error: BackupProblem; reason?: string } {
  if (!isRecord(json) || json.format !== 'antresol-backup') return { error: 'format' }
  if (json.version !== 1) return { error: 'version' }
  const app = record<{ schemaVersion: number }>(json.app, { schemaVersion: int })
  if (!app) return { error: 'format' }
  if (app.schemaVersion > APP_SCHEMA_VERSION) return { error: 'newer_schema' }
  if (app.schemaVersion <= SCHEMA_BASE) return { error: 'prerelease' }
  const source = record<{ name: string; kind: string }>(json.source, { name: str, kind: str })
  if (!source || !time(json.exportedAt) || !Array.isArray(json.inventories)) return { error: 'format' }
  if (app.schemaVersion <= LAST_PRE_RELEASE_SCHEMA && preReleaseShape(json.inventories)) return { error: 'prerelease' }
  const inventories: InventoryExport[] = []
  for (const entry of json.inventories) {
    const parsed = inventoryExport(entry)
    if (!parsed) return { error: 'format' }
    const problems = backupProblems(parsed)
    if (problems.length) return { error: 'format', reason: problems.join('; ') }
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

/** How the restore sheet offers a file, from this device's last run of it (DeviceDb.getRestoreRun) and how many
 *  inventories the source holds (archived included). `unfinished`: that run, into this source, did not finish: it is
 *  offered again in its mode. The same ids only into an empty source, or to go on with such a run. `restoredBefore`:
 *  that run, into this source, finished; new ids now make another copy. */
export function restoreChoice(input: { run: RestoreRun | null; sourceId: string; sourceInventories: number }): {
  mode: RestoreMode
  sameIdsAllowed: boolean
  unfinished: boolean
  restoredBefore: boolean
} {
  const here = input.run?.sourceId === input.sourceId ? input.run : null
  const unfinished = here !== null && !here.finished
  const empty = input.sourceInventories === 0
  return {
    mode: unfinished ? here.mode : empty ? 'same-ids' : 'new-ids',
    sameIdsAllowed: empty || (unfinished && here.mode === 'same-ids'),
    unfinished,
    restoredBefore: here !== null && here.finished,
  }
}

/** The toast after a restore, by what it actually added: inventories when any, otherwise records, otherwise nothing. */
export function restoreOutcome(added: { inventories: number; rows: number }): {
  key: 'backup.restored' | 'backup.restoredRows' | 'backup.restoredNothing'
  count: number
} {
  if (added.inventories > 0) return { key: 'backup.restored', count: added.inventories }
  if (added.rows > 0) return { key: 'backup.restoredRows', count: added.rows }
  return { key: 'backup.restoredNothing', count: 0 }
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

/**
 * The reminder's watch: when the current inventory's Neon source is ready, and again after every write any source took
 * (state.writeCount: stock writes too, which never set `saving`), reads this device's bookkeeping of it and calls
 * `remind` the first time a backup is due (createBackupReminder: once per session). Never by a timer. A source never
 * backed up counts from when it was added on this device. The demo source lives on the device: never reminded about.
 */
export function watchBackupReminder(
  workspace: Pick<Workspace, 'state' | 'backupInfo'>,
  remind: (config: SourceConfig, info: BackupInfo) => void,
  now: () => Date = () => new Date(),
): WatchStopHandle {
  const { state } = workspace
  const reminder = createBackupReminder()
  const target = computed(() => {
    const source = state.sources.find((s) => s.config.id === state.current?.sourceId)
    return source?.config.kind === 'neon' && source.status === 'ready' ? source.config : null
  })
  let shown = false
  return watch(
    [target, () => state.writeCount],
    async ([config]) => {
      // Once reminded, nothing more to read this session.
      if (!config || shown) return
      const info = await workspace.backupInfo(config.id)
      if (!reminder.due({ lastBackupAt: info.lastBackupAt ?? config.createdAt, writesSince: info.writesSince, now: now() })) return
      shown = true
      remind(config, info)
    },
    { immediate: true },
  )
}
