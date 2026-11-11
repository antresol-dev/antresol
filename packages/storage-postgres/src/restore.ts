import {
  CURRENCIES,
  StorageError,
  type Id,
  type InventoryExport,
  type RestoreMode,
  type RestoreOptions,
  type RestoreResult,
} from '@graymatter/core'
import type { PgExecutor } from './executor'
import { LOCK_REV, REV_BUMP } from './migrator'
import type { Statement } from './sql'

/** Rows per write transaction: small enough for one Neon HTTP request, few enough requests for a large backup. */
export const RESTORE_BATCH_ROWS = 500

// ---- deterministic ids ----

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function uuidBytes(id: string): Uint8Array {
  if (!UUID.test(id)) throw new Error(`not a uuid: ${id}`)
  const hex = id.replace(/-/g, '')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

const rotl = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0

/** SHA-1 (FIPS 180-4), for UUID v5 only: synchronous and fast for tens of thousands of ids, unlike crypto.subtle. */
function sha1(message: Uint8Array): Uint8Array {
  const length = Math.ceil((message.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  const bits = message.length * 8
  view.setUint32(length - 8, Math.floor(bits / 2 ** 32))
  view.setUint32(length - 4, bits >>> 0)
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]
  const w = new Array<number>(80).fill(0)
  for (let block = 0; block < length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4)
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1)
    let [a, b, c, d, e] = h as [number, number, number, number, number]
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20
          ? [(b & c) | (~b & d), 0x5a827999]
          : i < 40
            ? [b ^ c ^ d, 0x6ed9eba1]
            : i < 60
              ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
              : [b ^ c ^ d, 0xca62c1d6]
      const t = (rotl(a, 5) + f + e + k + w[i]!) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = t
    }
    h[0] = (h[0]! + a) >>> 0
    h[1] = (h[1]! + b) >>> 0
    h[2] = (h[2]! + c) >>> 0
    h[3] = (h[3]! + d) >>> 0
    h[4] = (h[4]! + e) >>> 0
  }
  const out = new Uint8Array(20)
  const outView = new DataView(out.buffer)
  h.forEach((word, i) => outView.setUint32(i * 4, word))
  return out
}

const encoder = new TextEncoder()

/** RFC 4122 name-based UUID, version 5 (SHA-1): the same name in the same namespace always gives the same id. */
export function uuidV5(name: string, namespace: string): string {
  const ns = uuidBytes(namespace)
  const text = encoder.encode(name)
  const input = new Uint8Array(ns.length + text.length)
  input.set(ns)
  input.set(text, ns.length)
  const hash = sha1(input).slice(0, 16)
  hash[6] = (hash[6]! & 0x0f) | 0x50
  hash[8] = (hash[8]! & 0x3f) | 0x80
  const hex = Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// ---- what is written ----

/**
 * One column the restore writes. `ref`: what the value names, renamed in new-ids mode: `id` for a uuid (the row's own id
 * or a reference to another row, archive and transfer groups included), `unitKey` for `custom:<unit id>`. A test checks
 * against the database that every uuid column of the schema is declared `id`, so a new one cannot be forgotten.
 * `type`: the Postgres array type its values travel in (`json` for an array column: one JSON text per row).
 */
export interface RestoreColumn {
  name: string
  type: 'uuid' | 'text' | 'timestamptz' | 'boolean' | 'int' | 'smallint' | 'numeric' | 'bigint' | 'json-text' | 'json-smallint'
  ref?: 'id' | 'unitKey'
}
export interface RestoreTable {
  name: string
  /** The primary key: the insert's conflict target. A test checks it against the database. */
  key: readonly string[]
  columns: RestoreColumn[]
}

type Raw = string | number | boolean | null | readonly (string | number)[]

const id = (name: string): RestoreColumn => ({ name, type: 'uuid', ref: 'id' })
const text = (name: string): RestoreColumn => ({ name, type: 'text' })
const time = (name: string): RestoreColumn => ({ name, type: 'timestamptz' })
const AUDIT = [time('created_at'), time('updated_at'), text('created_by'), text('updated_by')]
const ARCHIVE = [time('archived_at'), id('archive_id')]

/** In insert order: every row's references are written before it (folders parents first, see planRestore). */
export const RESTORE_TABLES: readonly RestoreTable[] = [
  { name: 'inventories', key: ['id'], columns: [id('id'), text('name'), text('description'), text('currency'), ...AUDIT, ...ARCHIVE] },
  {
    name: 'folders',
    key: ['id'],
    columns: [id('id'), id('inventory_id'), id('parent_id'), text('name'), text('description'), ...AUDIT, ...ARCHIVE],
  },
  { name: 'tags', key: ['id'], columns: [id('id'), id('inventory_id'), text('name'), ...AUDIT] },
  {
    name: 'attributes',
    key: ['id'],
    columns: [
      id('id'), id('inventory_id'), text('name'), text('kind'), { name: 'options', type: 'json-text' }, text('unit'),
      { name: 'si_prefixes', type: 'boolean' }, { name: 'pinned', type: 'boolean' }, ...AUDIT,
    ],
  },
  {
    name: 'custom_units',
    key: ['id'],
    columns: [id('id'), id('inventory_id'), text('name'), text('symbol'), { name: 'prefix_powers', type: 'json-smallint' }, ...AUDIT],
  },
  {
    name: 'items',
    key: ['id'],
    columns: [
      id('id'), id('inventory_id'), id('folder_id'), text('name'), text('description'),
      { name: 'unit_key', type: 'text', ref: 'unitKey' }, ...AUDIT, ...ARCHIVE,
    ],
  },
  { name: 'item_tags', key: ['item_id', 'tag_id'], columns: [id('item_id'), id('tag_id')] },
  {
    name: 'variants',
    key: ['id'],
    columns: [id('id'), id('item_id'), text('description'), { name: 'position', type: 'int' }, ...AUDIT, ...ARCHIVE],
  },
  {
    name: 'item_attributes',
    key: ['item_id', 'attribute_id'],
    columns: [id('item_id'), id('attribute_id'), text('value'), { name: 'axis_position', type: 'int' }],
  },
  { name: 'variant_attribute_values', key: ['variant_id', 'attribute_id'], columns: [id('variant_id'), id('attribute_id'), text('value')] },
  {
    name: 'photos',
    key: ['id'],
    columns: [
      id('id'), id('item_id'), id('variant_id'), text('provider'), text('file_id'), text('url'), { name: 'position', type: 'int' },
      time('created_at'), text('created_by'),
    ],
  },
  {
    name: 'movements',
    key: ['id'],
    columns: [
      id('id'), id('inventory_id'), id('item_id'), id('variant_id'), text('kind'), { name: 'quantity', type: 'numeric' },
      { name: 'total_price', type: 'bigint' }, text('source_url'), text('note'), id('transfer_id'), time('created_at'),
      text('created_by'),
    ],
  },
]

const TABLE = new Map(RESTORE_TABLES.map((t) => [t.name, t]))

/** One table's rows of one inventory, values as the backup has them (old ids), in RESTORE_TABLES column order. */
interface Segment {
  table: RestoreTable
  rows: Raw[][]
}

const SMALLINT = 2 ** 15
const INT = 2 ** 31
const fits = (value: number, bound: number): boolean => Number.isInteger(value) && value >= -bound && value < bound

/**
 * What keeps the inventory from being restored, at most 5 problems ([]: none): a reference that does not resolve
 * inside it (the restore would fail midway on a foreign key or, with the same ids, link to a row of another inventory),
 * a folder cycle, or a value the schema cannot hold (an unknown currency, a prefix power or position out of its
 * column's range, two attributes of an item at one axis position). Checked before anything is written, so a bad file
 * never fails a restore halfway.
 */
export function backupProblems({ snapshot: s, movements }: InventoryExport): string[] {
  const has = (rows: { id: Id }[]) => new Set(rows.map((r) => r.id))
  const folders = has(s.folders)
  const items = has(s.items)
  const variants = has(s.variants)
  const tags = has(s.tags)
  const attributes = has(s.attributes)
  const variantItem = new Map(s.variants.map((v) => [v.id, v.itemId]))
  const problems: string[] = []
  const need = (ok: boolean, what: string): void => {
    if (!ok && problems.length < 5) problems.push(what)
  }
  const bucket = (itemId: Id, variantId: Id | null): boolean =>
    items.has(itemId) && (variantId === null || variantItem.get(variantId) === itemId)
  need(Object.hasOwn(CURRENCIES, s.inventory.currency), `inventory ${s.inventory.id}: unknown currency ${JSON.stringify(s.inventory.currency)}`)
  for (const f of s.folders) need(f.parentId === null || folders.has(f.parentId), `folder ${f.id}: parent`)
  const parentOf = new Map(s.folders.map((f) => [f.id, f.parentId]))
  for (const f of s.folders) {
    const seen = new Set<Id>()
    let cur: Id | null | undefined = f.id
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      cur = parentOf.get(cur)
    }
    need(!cur, `folder ${f.id}: in a cycle`)
  }
  for (const u of s.units) need(u.prefixPowers.every((p) => fits(p, SMALLINT)), `unit ${u.id}: prefix power out of range`)
  for (const i of s.items) {
    need(i.folderId === null || folders.has(i.folderId), `item ${i.id}: folder`)
    for (const t of i.tagIds) need(tags.has(t), `item ${i.id}: tag ${t}`)
  }
  for (const v of s.variants) {
    need(items.has(v.itemId), `variant ${v.id}: item`)
    need(fits(v.position, INT), `variant ${v.id}: position out of range`)
  }
  const axes = new Set<string>()
  for (const r of s.itemAttributes) {
    need(items.has(r.itemId) && attributes.has(r.attributeId), `item attribute ${r.itemId}`)
    if (r.axisPosition === null) continue
    need(fits(r.axisPosition, INT), `item ${r.itemId}: axis position out of range`)
    const axis = `${r.itemId}:${r.axisPosition}`
    need(!axes.has(axis), `item ${r.itemId}: two attributes at axis position ${r.axisPosition}`)
    axes.add(axis)
  }
  for (const r of s.variantAttributeValues) need(variants.has(r.variantId) && attributes.has(r.attributeId), `variant value ${r.variantId}`)
  for (const p of s.photos) {
    need(bucket(p.itemId, p.variantId), `photo ${p.id}`)
    need(fits(p.position, INT), `photo ${p.id}: position out of range`)
  }
  for (const m of movements) need(bucket(m.itemId, m.variantId), `movement ${m.id}`)
  return problems
}

function checkBackup(entry: InventoryExport): void {
  const problems = backupProblems(entry)
  if (problems.length) {
    throw new StorageError('failed', `the backup of inventory ${entry.snapshot.inventory.id} is inconsistent: ${problems.join(', ')}`)
  }
}

/** Parents before children (by depth), so a batch never holds a folder whose parent comes in a later one. The tree has
 *  no cycle (checkBackup). */
function parentsFirst<T extends { id: Id; parentId: Id | null }>(folders: T[]): T[] {
  const parentOf = new Map(folders.map((f) => [f.id, f.parentId]))
  const depthOf = (f: T): number => {
    let depth = 0
    for (let cur = f.parentId; cur; cur = parentOf.get(cur) ?? null) depth++
    return depth
  }
  const depth = new Map(folders.map((f) => [f.id, depthOf(f)]))
  return [...folders].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)
}

function segmentsOf(entry: InventoryExport): Segment[] {
  const { snapshot: s, movements } = entry
  const inv = s.inventory.id
  const audit = (r: { createdAt: string; updatedAt: string; createdBy: string; updatedBy: string }): Raw[] => [
    r.createdAt, r.updatedAt, r.createdBy, r.updatedBy,
  ]
  const archive = (r: { archivedAt: string | null; archiveId: Id | null }): Raw[] => [r.archivedAt, r.archiveId]
  const rows: [string, Raw[][]][] = [
    ['inventories', [[inv, s.inventory.name, s.inventory.description, s.inventory.currency, ...audit(s.inventory), ...archive(s.inventory)]]],
    ['folders', parentsFirst(s.folders).map((f) => [f.id, inv, f.parentId, f.name, f.description, ...audit(f), ...archive(f)])],
    ['tags', s.tags.map((t) => [t.id, inv, t.name, ...audit(t)])],
    ['attributes', s.attributes.map((a) => [a.id, inv, a.name, a.kind, a.options, a.unit, a.siPrefixes, a.pinned, ...audit(a)])],
    ['custom_units', s.units.map((u) => [u.id, inv, u.name, u.symbol, u.prefixPowers, ...audit(u)])],
    ['items', s.items.map((i) => [i.id, inv, i.folderId, i.name, i.description, i.unitKey, ...audit(i), ...archive(i)])],
    ['item_tags', s.items.flatMap((i) => [...new Set(i.tagIds)].map((t) => [i.id, t]))],
    ['variants', s.variants.map((v) => [v.id, v.itemId, v.description, v.position, ...audit(v), ...archive(v)])],
    ['item_attributes', s.itemAttributes.map((r) => [r.itemId, r.attributeId, r.value, r.axisPosition])],
    ['variant_attribute_values', s.variantAttributeValues.map((r) => [r.variantId, r.attributeId, r.value])],
    ['photos', s.photos.map((p) => [p.id, p.itemId, p.variantId, p.provider, p.fileId, p.url, p.position, p.createdAt, p.createdBy])],
    [
      'movements',
      // Oldest first: the new `seq` keeps the journal's order (last price, last recount).
      [...movements]
        .sort((a, b) => a.seq - b.seq)
        .map((m) => [
          m.id, inv, m.itemId, m.variantId, m.kind, m.quantity, m.totalPrice, m.sourceUrl, m.note, m.transferId, m.createdAt,
          m.createdBy,
        ]),
    ],
  ]
  return rows.filter(([, list]) => list.length > 0).map(([name, list]) => ({ table: TABLE.get(name)!, rows: list }))
}

const CUSTOM = 'custom:'

/** A row's values as they are written: ids renamed by `rename`, arrays as JSON, everything else as text. */
function finalRow(columns: RestoreColumn[], raw: Raw[], rename: (old: Id) => Id): (string | null)[] {
  return columns.map((column, i) => {
    const value = raw[i] ?? null
    if (value === null) return null
    if (column.ref === 'id') return rename(String(value))
    if (column.ref === 'unitKey' && typeof value === 'string' && value.startsWith(CUSTOM)) {
      return CUSTOM + rename(value.slice(CUSTOM.length))
    }
    if (Array.isArray(value)) return JSON.stringify(value)
    return String(value)
  })
}

const ARRAY_TYPE: Record<RestoreColumn['type'], string> = {
  uuid: 'uuid[]',
  text: 'text[]',
  timestamptz: 'timestamptz[]',
  boolean: 'boolean[]',
  int: 'int[]',
  smallint: 'smallint[]',
  numeric: 'numeric[]',
  bigint: 'bigint[]',
  'json-text': 'text[]',
  'json-smallint': 'text[]',
}

function selectExpression(column: RestoreColumn): string {
  const value = `r."${column.name}"`
  if (column.type === 'json-text') {
    return `array(select x.e from jsonb_array_elements_text(${value}::jsonb) with ordinality as x(e, n) order by x.n)`
  }
  if (column.type === 'json-smallint') {
    return `array(select x.e::smallint from jsonb_array_elements_text(${value}::jsonb) with ordinality as x(e, n) order by x.n)`
  }
  return value
}

/** One insert of a table's rows through unnest, one array parameter per column, in the rows' order (movements get their
 *  `seq` in it). Never overwrites: a row whose primary key is already there, from an earlier run of the same restore, is
 *  skipped; any other collision (a unique index) fails the batch rather than dropping the row unseen. Its one result
 *  row: `added`, how many rows went in. */
function insertStatement(table: RestoreTable, rows: (string | null)[][]): Statement {
  const names = table.columns.map((c) => `"${c.name}"`).join(', ')
  const arrays = table.columns.map((c, i) => `$${i + 1}::${ARRAY_TYPE[c.type]}`).join(', ')
  const select = table.columns.map(selectExpression).join(', ')
  const key = table.key.map((c) => `"${c}"`).join(', ')
  return {
    text: `with gm_added as (
insert into ${table.name} (${names})
select ${select}
from unnest(${arrays}) with ordinality as r(${names}, gm_ord)
order by r.gm_ord
on conflict (${key}) do nothing
returning 1
)
select count(*)::int as added from gm_added`,
    params: table.columns.map((_, i) => rows.map((row) => row[i] ?? null)),
  }
}

/** Message and SQLSTATE of the error the first batch of a same-ids restore raises when the source holds an inventory. */
export const RESTORE_NOT_EMPTY_MESSAGE = 'gm_restore_not_empty'
export const RESTORE_NOT_EMPTY_SQLSTATE = 'GM002'

/** Right after the revision lock in the first batch of a same-ids restore (not one that goes on with an earlier run):
 *  fails unless the source holds no inventory. Every other row hangs off an inventory. A plain statement: fits one Neon
 *  HTTP transaction. */
const EMPTY_SOURCE_GUARD: Statement = {
  text: `do $$ begin
  if exists (select 1 from inventories) then
    raise exception '${RESTORE_NOT_EMPTY_MESSAGE}' using errcode = '${RESTORE_NOT_EMPTY_SQLSTATE}';
  end if;
end $$`,
  params: [],
}

function isNotEmptyRefusal(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (e as { code?: unknown }).code === RESTORE_NOT_EMPTY_SQLSTATE && e.message.includes(RESTORE_NOT_EMPTY_MESSAGE)
}

interface Batch {
  inserts: { table: string; statement: Statement }[]
  rows: number
}

/** The inventories' rows in insert order, grouped into batches of at most `batchRows` rows. */
function plan(
  backup: { inventories: InventoryExport[] },
  rename: (old: Id) => Id,
  batchRows: number,
): { batches: Batch[]; total: number } {
  const batches: Batch[] = []
  let current: Batch = { inserts: [], rows: 0 }
  let total = 0
  for (const entry of backup.inventories) {
    for (const { table, rows } of segmentsOf(entry)) {
      total += rows.length
      for (let at = 0; at < rows.length; ) {
        const take = Math.min(batchRows - current.rows, rows.length - at)
        const chunk = rows.slice(at, at + take).map((raw) => finalRow(table.columns, raw, rename))
        current.inserts.push({ table: table.name, statement: insertStatement(table, chunk) })
        current.rows += take
        at += take
        if (current.rows === batchRows) {
          batches.push(current)
          current = { inserts: [], rows: 0 }
        }
      }
    }
  }
  if (current.rows > 0) batches.push(current)
  return { batches, total }
}

/**
 * InventoryStorage.restore (see there). Each batch is one transaction: the revision lock first (writes and migrations
 * queue on it, as with apply), in the first batch of a same-ids restore the empty-source check, the inserts, the
 * revision bump. `batchRows`: tests use small batches.
 */
export async function restoreBackup(
  exec: PgExecutor,
  backup: { inventories: InventoryExport[] },
  mode: RestoreMode,
  runId: Id,
  options: RestoreOptions = {},
  batchRows: number = RESTORE_BATCH_ROWS,
): Promise<RestoreResult> {
  if (!Number.isInteger(batchRows) || batchRows < 1) throw new Error(`invalid batch size ${batchRows}`)
  for (const entry of backup.inventories) checkBackup(entry)
  let rename: (old: Id) => Id = (old) => old
  if (mode === 'new-ids') {
    uuidBytes(runId)
    const known = new Map<Id, Id>()
    rename = (old) => {
      const key = old.toLowerCase()
      let renamed = known.get(key)
      if (renamed === undefined) {
        renamed = uuidV5(key, runId)
        known.set(key, renamed)
      }
      return renamed
    }
  }
  const { onProgress } = options
  const guarded = mode === 'same-ids' && !options.resumeSameIds
  const { batches, total } = plan(backup, rename, batchRows)
  const added = { inventories: 0, rows: 0 }
  let done = 0
  onProgress?.(done, total)
  for (const [index, batch] of batches.entries()) {
    const guard = guarded && index === 0 ? [EMPTY_SOURCE_GUARD] : []
    let results: Record<string, unknown>[][]
    try {
      results = await exec.batch([LOCK_REV, ...guard, ...batch.inserts.map((i) => i.statement), REV_BUMP])
    } catch (e) {
      if (guard.length && isNotEmptyRefusal(e)) {
        throw new StorageError('not_empty', 'a restore with the same ids goes only into a source without inventories')
      }
      throw e
    }
    batch.inserts.forEach(({ table }, i) => {
      const count = Number(results[1 + guard.length + i]?.[0]?.added ?? 0)
      added.rows += count
      if (table === 'inventories') added.inventories += count
    })
    done += batch.rows
    onProgress?.(done, total)
  }
  return { inventoryIds: backup.inventories.map((e) => rename(e.snapshot.inventory.id)), added }
}
