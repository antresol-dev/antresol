import {
  StorageError,
  type Id,
  type InventoryExport,
  type Intake,
  type InventorySnapshot,
  type Movement,
  type Inventory,
  type SourceReceipt,
} from '@antresol/core'
import type { PgExecutor } from './executor'
import { INTAKES_REV_KEY } from './migrator'
import * as rows from './rows'
import { sql, type Statement } from './sql'

const AUDIT = 'created_at, updated_at, created_by, updated_by'
const ARCHIVE = 'archived_at, archive_id'

/** The inventories and the revision counter, read in one snapshot transaction (so `rev` matches the list). */
const revStatement = sql`select value from antresol_meta where key = 'rev'`

/** A missing row (hand-edited database) is "unknown": a value that never equals one a device cached. */
export const toRev = (result: Record<string, unknown>[] | undefined): string =>
  String((result?.[0] as { value?: unknown } | undefined)?.value ?? `unknown:${Math.random().toString(36).slice(2)}`)

export async function listInventories(exec: PgExecutor): Promise<{ inventories: Inventory[]; rev: string }> {
  const [list, rev] = await exec.readBatch([
    sql`select id, name, description, currency::text as currency, ${raw(`${AUDIT}, ${ARCHIVE}`)}
        from inventories order by name, id`,
    revStatement,
  ])
  return { inventories: (list as Record<string, unknown>[]).map(rows.toInventory), rev: toRev(rev) }
}

/** Fixed number of queries (one per kind of data), in one read-only snapshot transaction; archived records included. */
export async function loadInventory(exec: PgExecutor, id: Id): Promise<InventorySnapshot> {
  return toSnapshot((await exec.readBatch(snapshotStatements(id))) as SnapshotRows, id)
}

/** The snapshot and the source revision, in ONE read-only snapshot transaction: the revision is exactly the one the
 *  snapshot is at. */
export async function loadInventoryWithRev(exec: PgExecutor, id: Id): Promise<{ snapshot: InventorySnapshot; rev: string }> {
  const result = await exec.readBatch([...snapshotStatements(id), revStatement])
  return { snapshot: toSnapshot(result.slice(0, SNAPSHOT_STATEMENTS) as SnapshotRows, id), rev: toRev(result[SNAPSHOT_STATEMENTS]) }
}

/** The snapshot and every movement of the inventory, in ONE read-only snapshot transaction (one round trip), so a
 *  backup never mixes two states. Throws `not_found` when the inventory does not exist. */
export async function exportInventory(
  exec: PgExecutor,
  id: Id,
): Promise<InventoryExport> {
  const result = await exec.readBatch([...snapshotStatements(id), movementsStatement(id), intakesSql(sql`inventory_id = ${id}`)])
  const snapshot = toSnapshot(result.slice(0, SNAPSHOT_STATEMENTS) as SnapshotRows, id)
  return {
    snapshot,
    movements: (result[SNAPSHOT_STATEMENTS] ?? []).map(rows.toMovement),
    intakes: (result[SNAPSHOT_STATEMENTS + 1] ?? []).map(rows.toIntake),
  }
}

const SNAPSHOT_STATEMENTS = 11

/**
 * The snapshot's reads, each over a filter, so a write can read the same columns with the same row mappers for just the
 * rows it touched (commands/reads.ts): a patched snapshot equals a fresh load by construction.
 * - `inventoryId`: an SQL expression for the inventory's id.
 * - `where`: a condition on the item, aliased `i`, that every per-item read joins to (`i.inventory_id = $1` for the
 *   whole inventory, `i.id = $1` for one item's slice).
 * - stock's `where`: a condition on `movements` columns, whose `inventory_id` is the item's.
 */
export const snapshotSql = {
  inventory: (inventoryId: Statement) =>
    sql`select id, name, description, currency::text as currency, ${raw(`${AUDIT}, ${ARCHIVE}`)}
          from inventories where id = ${inventoryId}`,
  folders: (inventoryId: Statement) =>
    sql`select id, inventory_id, parent_id, name, description, ${raw(`${AUDIT}, ${ARCHIVE}`)}
          from folders where inventory_id = ${inventoryId} order by name, id`,
  items: (where: Statement) =>
    sql`select i.id, i.inventory_id, i.folder_id, i.name, i.description, i.unit_key,
                 i.created_at, i.updated_at, i.created_by, i.updated_by, i.archived_at, i.archive_id,
                 coalesce((select array_agg(it.tag_id::text order by it.tag_id) from item_tags it
                           where it.item_id = i.id), '{}') as tag_ids
          from items i where ${where} order by i.name, i.id`,
  variants: (where: Statement) =>
    sql`select v.id, v.item_id, v.description, v.position::text as position,
                 v.created_at, v.updated_at, v.created_by, v.updated_by, v.archived_at, v.archive_id
          from variants v join items i on i.id = v.item_id
          where ${where} order by v.item_id, v.position, v.id`,
  tags: (inventoryId: Statement) =>
    sql`select id, inventory_id, name, ${raw(AUDIT)} from tags where inventory_id = ${inventoryId} order by name, id`,
  attributes: (inventoryId: Statement) =>
    sql`select id, inventory_id, name, kind, options, unit, si_prefixes, pinned, ${raw(AUDIT)}
          from attributes where inventory_id = ${inventoryId} order by name, id`,
  units: (inventoryId: Statement) =>
    sql`select id, inventory_id, name, symbol, prefix_powers, ${raw(AUDIT)}
          from custom_units where inventory_id = ${inventoryId} order by name, id`,
  itemAttributes: (where: Statement) =>
    sql`select ia.item_id, ia.attribute_id, ia.value, ia.axis_position
          from item_attributes ia join items i on i.id = ia.item_id
          where ${where} order by ia.item_id, ia.attribute_id`,
  variantAttributeValues: (where: Statement) =>
    sql`select va.variant_id, va.attribute_id, va.value
          from variant_attribute_values va
          join variants v on v.id = va.variant_id join items i on i.id = v.item_id
          where ${where} order by va.variant_id, va.attribute_id`,
  photos: (where: Statement) =>
    sql`select p.id, p.item_id, p.variant_id, p.provider, p.file_id, p.url, p.position::text as position,
                 p.created_at, p.created_by, p.urls, p.width, p.height, p.delete_handle
          from photos p join items i on i.id = p.item_id
          where ${where} order by p.item_id, p.position, p.id`,
  stock: (where: Statement) =>
    sql`select item_id, variant_id,
                 sum(quantity)::text as quantity,
                 coalesce(sum(quantity) filter (where kind = 'receipt' and total_price is not null), 0)::text
                   as priced_quantity,
                 coalesce(sum(total_price) filter (where kind = 'receipt' and total_price is not null), 0)::text
                   as priced_total,
                 (array_agg(total_price order by seq desc)
                    filter (where kind = 'receipt' and total_price is not null))[1]::text as last_total_price,
                 (array_agg(quantity order by seq desc)
                    filter (where kind = 'receipt' and total_price is not null))[1]::text as last_quantity,
                 (array_agg(created_at order by seq desc)
                    filter (where kind = 'receipt' and total_price is not null))[1] as last_at,
                 max(created_at) filter (where kind = 'adjustment') as last_counted_at
          from movements where ${where}
          group by item_id, variant_id order by item_id, variant_id nulls first`,
}

function snapshotStatements(id: Id) {
  const inventoryId = sql`${id}`
  const ofInventory = sql`i.inventory_id = ${id}`
  return [
    snapshotSql.inventory(inventoryId),
    snapshotSql.folders(inventoryId),
    snapshotSql.items(ofInventory),
    snapshotSql.variants(ofInventory),
    snapshotSql.tags(inventoryId),
    snapshotSql.attributes(inventoryId),
    snapshotSql.units(inventoryId),
    snapshotSql.itemAttributes(ofInventory),
    snapshotSql.variantAttributeValues(ofInventory),
    snapshotSql.photos(ofInventory),
    snapshotSql.stock(sql`inventory_id = ${id}`),
  ]
}

function toSnapshot(
  [inv, folders, items, variants, tags, attributes, units, itemAttrs, variantAttrs, photos, stock]: SnapshotRows,
  id: Id,
): InventorySnapshot {
  const inventory = inv[0]
  if (!inventory) throw new StorageError('not_found', `inventory not found: ${id}`)
  return {
    inventory: rows.toInventory(inventory),
    folders: folders.map(rows.toFolder),
    items: items.map(rows.toItem),
    variants: variants.map(rows.toVariant),
    tags: tags.map(rows.toTag),
    attributes: attributes.map(rows.toAttribute),
    units: units.map(rows.toCustomUnit),
    itemAttributes: itemAttrs.map(rows.toItemAttribute),
    variantAttributeValues: variantAttrs.map(rows.toVariantAttributeValue),
    photos: photos.map(rows.toPhoto),
    stock: stock.map(rows.toStockLine),
  }
}

/** Newest first. The order names the table column: a bare `seq` would sort by the `seq::text` output alias. */
export async function loadMovements(exec: PgExecutor, itemId: Id): Promise<Movement[]> {
  const result = await exec.query(
    sql`select id, seq::text as seq, item_id, variant_id, kind, quantity::text as quantity,
               total_price::text as total_price, source_url, note, transfer_id, intake_id, created_at, created_by
        from movements m where item_id = ${itemId} order by m.seq desc`,
  )
  return result.map(rows.toMovement)
}

/** Oldest first: one constant statement by `inventory_id` (the order names the column, not the `seq::text` alias). */
export async function loadAllMovements(exec: PgExecutor, inventoryId: Id): Promise<Movement[]> {
  return (await exec.query(movementsStatement(inventoryId))).map(rows.toMovement)
}

function movementsStatement(inventoryId: Id) {
  return sql`select id, seq::text as seq, item_id, variant_id, kind, quantity::text as quantity,
               total_price::text as total_price, source_url, note, transfer_id, intake_id, created_at, created_by
        from movements m where inventory_id = ${inventoryId} order by m.seq asc`
}

/** The intakes revision (see InventoryStorage.listIntakes). */
export const intakesRevStatement = sql`select value from antresol_meta where key = ${INTAKES_REV_KEY}`

/** Every column toIntake reads, of the intakes the condition selects. */
export const intakesSql = (where: Statement) =>
  sql`select id, inventory_id, status, shop, order_number, purchased_on, note, draft, lines, draft_rev::text as draft_rev,
             ${raw(AUDIT)}, committed_at
      from intakes where ${where} order by updated_at desc, id`

/** The inventory's intakes, the most recently changed first, and the intakes revision, in one snapshot. */
export async function listIntakes(exec: PgExecutor, inventoryId: Id): Promise<{ intakes: Intake[]; intakesRev: string }> {
  const [list, rev] = await exec.readBatch([intakesSql(sql`inventory_id = ${inventoryId}`), intakesRevStatement])
  return { intakes: (list ?? []).map(rows.toIntake), intakesRev: toRev(rev) }
}

export async function intakesRev(exec: PgExecutor): Promise<string> {
  return toRev(await exec.query(intakesRevStatement))
}

/** Receipts a link search returns at most. */
const RECEIPTS_BY_SOURCE_LIMIT = 20
/** Newest candidate rows the whole-part check looks at: a key that sits inside many longer lot ids ("123" in
 *  "/item/41234.html") cannot pull a whole inventory's receipts. */
export const RECEIPTS_BY_SOURCE_SCAN = 200
const ALNUM = /[\p{L}\p{N}]/u

/** `key` occurs in `url` (both lowercased) with no letter or digit right before or after it: lot "123" is not in
 *  "/item/41234.html". */
function holdsKey(url: string, key: string): boolean {
  for (let at = url.indexOf(key); at !== -1; at = url.indexOf(key, at + 1)) {
    const before = url[at - 1]
    const after = url[at + key.length]
    if ((before === undefined || !ALNUM.test(before)) && (after === undefined || !ALNUM.test(after))) return true
  }
  return false
}

/** Newest first. `strpos` takes the key as plain text (no LIKE wildcards); the whole-part check runs here. */
export async function findReceiptsBySource(exec: PgExecutor, inventoryId: Id, key: string): Promise<SourceReceipt[]> {
  const k = key.trim().toLowerCase()
  if (k === '') return []
  const result = await exec.query(
    sql`select item_id, variant_id, quantity::text as quantity, source_url, created_at
        from movements m
        where inventory_id = ${inventoryId} and kind = 'receipt' and strpos(lower(source_url), ${k}) > 0
        order by m.seq desc
        limit ${raw(String(RECEIPTS_BY_SOURCE_SCAN))}`,
  )
  return result
    .filter((r) => holdsKey(String(r.source_url).toLowerCase(), k))
    .slice(0, RECEIPTS_BY_SOURCE_LIMIT)
    .map((r) => ({
      at: rows.toIso(r.created_at),
      itemId: r.item_id as Id,
      variantId: (r.variant_id as Id | null) ?? null,
      quantity: rows.toQuantity(r.quantity),
    }))
}

type R = Record<string, unknown>[]
/** One row set per statement of loadInventory's readBatch, in order. */
type SnapshotRows = [R, R, R, R, R, R, R, R, R, R, R]

/** Inline a constant SQL fragment (column lists only; never user input). */
function raw(text: string) {
  return { text, params: [] }
}
