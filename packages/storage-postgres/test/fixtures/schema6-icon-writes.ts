// FROZEN: the folder and item inserts before schema 7 (src/commands/folders.ts and items.ts before migration 0004),
// copied verbatim. They name no `icon` column, as every app of schema 6 and older wrote them: they must keep working
// on a database of any schema, and on one that has the column. Never edit.
import type { Actor, Command } from '@antresol/core'
import { sql, type Statement } from '../../src/sql'

export function folderCreate(c: Extract<Command, { type: 'folder.create' }>, actor: Actor): Statement {
  return sql`insert into folders (id, inventory_id, parent_id, name, description, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.parentId}, ${c.name}, ${c.description}, ${actor.device}, ${actor.device})
            on conflict (id) do nothing`
}

/** The statement of item.create without a receipt (the sample's items with one use `itemCreateWithReceipt`). */
export function itemCreate(c: Extract<Command, { type: 'item.create' }>, actor: Actor): Statement[] {
  const by = actor.device
  const receipt = c.initialReceipt
    ? (() => {
        const r = c.initialReceipt
        return sql`, mov as (
              insert into movements (id, inventory_id, item_id, variant_id, kind, quantity, total_price, source_url, note, created_by)
              select ${r.movementId}::uuid, ${c.inventoryId}::uuid, ins.id, null, 'receipt', ${r.quantity}::numeric,
                     ${r.totalPrice}::bigint, ${r.sourceUrl}, null, ${by} from ins
              on conflict (id) do nothing
            )`
      })()
    : sql``
  return [
    sql`with ins as (
              insert into items (id, inventory_id, folder_id, name, description, unit_key, created_by, updated_by)
              values (${c.id}, ${c.inventoryId}, ${c.folderId}, ${c.name}, ${c.description}, ${c.unitKey}, ${by}, ${by})
              on conflict (id) do nothing
              returning id
            )${receipt}
            insert into item_tags (item_id, tag_id)
            select distinct ins.id, t from ins, unnest(${c.tagIds}::uuid[]) as t`,
  ]
}
