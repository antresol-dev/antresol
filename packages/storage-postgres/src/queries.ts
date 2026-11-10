import { StorageError, type Id, type InventorySnapshot, type Movement, type Inventory } from '@graymatter/core'
import type { PgExecutor } from './executor'
import * as rows from './rows'
import { sql } from './sql'

const AUDIT = 'created_at, updated_at, created_by, updated_by'
const ARCHIVE = 'archived_at, archive_id'

export async function listInventories(exec: PgExecutor): Promise<Inventory[]> {
  const result = await exec.query(
    sql`select id, name, description, currency::text as currency, ${raw(`${AUDIT}, ${ARCHIVE}`)}
        from inventories order by name, id`,
  )
  return result.map(rows.toInventory)
}

/** Fixed number of queries (one per kind of data), in one read-only snapshot transaction; archived records included. */
export async function loadInventory(exec: PgExecutor, id: Id): Promise<InventorySnapshot> {
  const [inv, folders, items, variants, tags, attributes, units, itemAttrs, variantAttrs, photos, stock] =
    (await exec.readBatch([
      sql`select id, name, description, currency::text as currency, ${raw(`${AUDIT}, ${ARCHIVE}`)}
            from inventories where id = ${id}`,
      sql`select id, inventory_id, parent_id, name, description, ${raw(`${AUDIT}, ${ARCHIVE}`)}
            from folders where inventory_id = ${id} order by name, id`,
      sql`select i.id, i.inventory_id, i.folder_id, i.name, i.description, i.unit_key,
                   i.created_at, i.updated_at, i.created_by, i.updated_by, i.archived_at, i.archive_id,
                   coalesce((select array_agg(it.tag_id::text order by it.tag_id) from item_tags it
                             where it.item_id = i.id), '{}') as tag_ids
            from items i where i.inventory_id = ${id} order by i.name, i.id`,
      sql`select v.id, v.item_id, v.name, v.description, v.position::text as position,
                   v.created_at, v.updated_at, v.created_by, v.updated_by, v.archived_at, v.archive_id
            from variants v join items i on i.id = v.item_id
            where i.inventory_id = ${id} order by v.item_id, v.position, v.id`,
      sql`select id, inventory_id, name, ${raw(AUDIT)} from tags where inventory_id = ${id} order by name, id`,
      sql`select id, inventory_id, name, kind, options, ${raw(AUDIT)}
            from attributes where inventory_id = ${id} order by name, id`,
      sql`select id, inventory_id, name, symbol, prefix_powers, ${raw(AUDIT)}
            from custom_units where inventory_id = ${id} order by name, id`,
      sql`select ia.item_id, ia.attribute_id, ia.value
            from item_attributes ia join items i on i.id = ia.item_id
            where i.inventory_id = ${id} order by ia.item_id, ia.attribute_id`,
      sql`select va.variant_id, va.attribute_id, va.value
            from variant_attribute_values va
            join variants v on v.id = va.variant_id join items i on i.id = v.item_id
            where i.inventory_id = ${id} order by va.variant_id, va.attribute_id`,
      sql`select p.id, p.item_id, p.variant_id, p.provider, p.file_id, p.url, p.position::text as position,
                   p.created_at, p.created_by
            from photos p join items i on i.id = p.item_id
            where i.inventory_id = ${id} order by p.item_id, p.position, p.id`,
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
                      filter (where kind = 'receipt' and total_price is not null))[1] as last_at
            from movements where inventory_id = ${id}
            group by item_id, variant_id order by item_id, variant_id nulls first`,
    ])) as SnapshotRows
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
               total_price::text as total_price, source_url, note, transfer_id, created_at, created_by
        from movements m where item_id = ${itemId} order by m.seq desc`,
  )
  return result.map(rows.toMovement)
}

type R = Record<string, unknown>[]
/** One row set per statement of loadInventory's readBatch, in order. */
type SnapshotRows = [R, R, R, R, R, R, R, R, R, R, R]

/** Inline a constant SQL fragment (column lists only; never user input). */
function raw(text: string) {
  return { text, params: [] }
}
