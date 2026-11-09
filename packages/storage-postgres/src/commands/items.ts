import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type ItemCommand = Extract<
  Command,
  { type: 'item.create' | 'item.update' | 'item.setAttribute' | 'item.removeAttribute' }
>

function insertTags(itemId: string, tagIds: string[]): Statement {
  return sql`insert into item_tags (item_id, tag_id) select distinct ${itemId}::uuid, t from unnest(${tagIds}::uuid[]) as t`
}

export function itemStatements(c: ItemCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'item.create': {
      const statements = [
        sql`insert into items (id, inventory_id, folder_id, name, description, unit_key, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.folderId}, ${c.name}, ${c.description}, ${c.unitKey}, ${by}, ${by})`,
        insertTags(c.id, c.tagIds),
      ]
      if (c.initialReceipt) {
        const r = c.initialReceipt
        statements.push(
          sql`insert into movements (id, inventory_id, item_id, variant_id, kind, quantity, total_price, source_url, note, created_by)
              values (${r.movementId}, ${c.inventoryId}, ${c.id}, null, 'receipt', ${r.quantity}, ${r.totalPrice}, ${r.sourceUrl}, null, ${by})`,
        )
      }
      return statements
    }
    case 'item.update': {
      const statements = [
        sql`update items
            set ${updateSet({
              name: c.name,
              description: c.description,
              folder_id: c.folderId,
              unit_key: c.unitKey,
              updated_by: by,
            })}, updated_at = now()
            where id = ${c.id}`,
      ]
      if (c.tagIds) {
        statements.push(sql`delete from item_tags where item_id = ${c.id}`, insertTags(c.id, c.tagIds))
      }
      return statements
    }
    case 'item.setAttribute':
      return [
        sql`insert into item_attributes (item_id, attribute_id, value) values (${c.itemId}, ${c.attributeId}, ${c.value})
            on conflict (item_id, attribute_id) do update set value = excluded.value`,
      ]
    case 'item.removeAttribute':
      return [
        sql`delete from item_attributes where item_id = ${c.itemId} and attribute_id = ${c.attributeId}`,
        sql`delete from variant_attribute_values
            where attribute_id = ${c.attributeId}
              and variant_id in (select id from variants where item_id = ${c.itemId})`,
      ]
  }
}
