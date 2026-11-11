// FROZEN: the reads of the schema-3 app (src/queries.ts before schema 4), copied verbatim. A build of that version keeps
// running them against databases newer apps migrate, so a schema-4 database must answer them as before. Never edit:
// a later change to src/queries.ts is exactly what this copy must not follow.
import { sql, type Statement } from '../../src/sql'

const AUDIT = 'created_at, updated_at, created_by, updated_by'
const ARCHIVE = 'archived_at, archive_id'

function raw(text: string) {
  return { text, params: [] }
}

export const listInventories = (): Statement[] => [
  sql`select id, name, description, currency::text as currency, ${raw(`${AUDIT}, ${ARCHIVE}`)}
        from inventories order by name, id`,
  sql`select value from gm_meta where key = 'rev'`,
]

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
    sql`select id, inventory_id, name, kind, options, unit, si_prefixes, ${raw(AUDIT)}
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
                 p.created_at, p.created_by
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
                    filter (where kind = 'receipt' and total_price is not null))[1] as last_at
          from movements where ${where}
          group by item_id, variant_id order by item_id, variant_id nulls first`,
}

/** The schema-3 app's whole-inventory read (loadInventory), in its order. */
export function snapshotStatements(id: string): Statement[] {
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

export const movementsOfInventory = (inventoryId: string): Statement =>
  sql`select id, seq::text as seq, item_id, variant_id, kind, quantity::text as quantity,
               total_price::text as total_price, source_url, note, transfer_id, created_at, created_by
        from movements m where inventory_id = ${inventoryId} order by m.seq asc`
