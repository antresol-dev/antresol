import type { Actor, Command, Id } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type ItemCommand = Extract<
  Command,
  {
    type:
      | 'item.create'
      | 'item.update'
      | 'item.setAttribute'
      | 'item.removeAttribute'
      | 'item.addAxis'
      | 'item.removeAxis'
      | 'item.reorderAxes'
  }
>

function insertTags(itemId: string, tagIds: string[]): Statement {
  return sql`insert into item_tags (item_id, tag_id) select distinct ${itemId}::uuid, t from unnest(${tagIds}::uuid[]) as t`
}

// ---- axes (spec 2026-11-11 variants §4.6) ----
// core checks the rules against the device's copy; these statements carry out the consequences from what the database
// holds when the write runs, so a stale copy never leaves an axis with a value or a variant value on a shared attribute.
// A removal the database state forbids is skipped, not refused: the write still bumps the revision and returns the
// item's slice as the database has it, and the revision rules reload the device's copy (Plan 6 sync spec §4.2).

/**
 * True when the database lets the axis go (spec §4.6, §4.7), archived variants included: the item has no variants, or
 * another axis remains and the remaining axes still tell every two variants apart. Values compare as core's
 * `sameAxisValue` does: text without case and outer spaces, other kinds exactly, an empty value equal only to empty.
 * Postgres `lower` follows the database's locale and may fold some non-ASCII letters unlike JavaScript (under "C", none
 * at all): for such text this check is approximate, and core's check on the device stays the one that decides.
 */
function axisMayGo(itemId: Id, attributeId: Id): Statement {
  return sql`(
    not exists (select 1 from variants where item_id = ${itemId}::uuid)
    or (
      exists (select 1 from item_attributes
              where item_id = ${itemId}::uuid and axis_position is not null and attribute_id <> ${attributeId}::uuid)
      and not exists (
        select 1
        from variants v
        where v.item_id = ${itemId}::uuid
        group by array(
          select case when a.kind = 'text' then lower(btrim(va.value)) else va.value end
          from item_attributes r
          join attributes a on a.id = r.attribute_id
          left join variant_attribute_values va
            on va.variant_id = v.id and va.attribute_id = r.attribute_id and btrim(va.value) <> ''
          where r.item_id = ${itemId}::uuid and r.axis_position is not null and r.attribute_id <> ${attributeId}::uuid
          order by r.attribute_id
        )
        having count(*) > 1
      )
    )
  )`
}

/** The variants' values on the attribute, archived variants' included, once it is no longer an axis of the item: a
 *  removal the database skipped keeps them. */
function deleteVariantValues(itemId: Id, attributeId: Id): Statement {
  return sql`delete from variant_attribute_values va using variants v
             where va.variant_id = v.id and v.item_id = ${itemId}::uuid and va.attribute_id = ${attributeId}::uuid
               and not exists (select 1 from item_attributes
                               where item_id = ${itemId}::uuid and attribute_id = ${attributeId}::uuid
                                 and axis_position is not null)`
}

/**
 * Renumbers the item's axes 0..n-1: the axes named in `order` first, in that order, then the others in their current
 * order (a list from a stale copy may miss an axis or name an attribute that is no longer one). Two statements, because
 * the unique (item, axis position) index is checked row by row and one update could collide halfway: every position goes
 * negative first (-1 - p keeps the order, reversed), then each takes its final place.
 */
function renumberAxes(itemId: Id, order: Id[]): Statement[] {
  return [
    sql`update item_attributes set axis_position = -1 - axis_position
        where item_id = ${itemId}::uuid and axis_position is not null`,
    sql`update item_attributes ia set axis_position = r.position
        from (
          select attribute_id,
                 (row_number() over (order by array_position(${order}::uuid[], attribute_id) nulls last,
                                              axis_position desc) - 1)::int as position
          from item_attributes where item_id = ${itemId}::uuid and axis_position is not null
        ) r
        where ia.item_id = ${itemId}::uuid and ia.attribute_id = r.attribute_id`,
  ]
}

/**
 * Attribute -> axis. In order, each statement seeing what the previous ones wrote:
 * 1. a shared attribute with a value, on an item with no variants and no other axis: the value becomes the first variant
 *    (`firstVariantId`, position 0, as createMany would give it); an item that already has an axis gets no variant,
 *    since a new variant needs a value on every axis (spec §3.6);
 * 2. a shared value moves to every variant of the item, archived ones and the new first one included;
 * 3. the attribute becomes the last axis, its shared value gone; attached if it was not. Already an axis: nothing.
 */
function addAxis(c: Extract<Command, { type: 'item.addAxis' }>, by: string): Statement[] {
  const item = c.itemId
  const attribute = c.attributeId
  const sharedWithValue = sql`ia.item_id = ${item}::uuid and ia.attribute_id = ${attribute}::uuid
                              and ia.axis_position is null and ia.value <> ''`
  return [
    sql`insert into variants (id, item_id, position, created_by, updated_by)
        select ${c.firstVariantId}::uuid, ia.item_id, 0, ${by}, ${by}
        from item_attributes ia
        where ${sharedWithValue}
          and not exists (select 1 from variants where item_id = ${item}::uuid)
          and not exists (select 1 from item_attributes where item_id = ${item}::uuid and axis_position is not null)
        on conflict (id) do nothing`,
    sql`insert into variant_attribute_values (variant_id, attribute_id, value)
        select v.id, ia.attribute_id, ia.value
        from item_attributes ia join variants v on v.item_id = ia.item_id
        where ${sharedWithValue}
        on conflict (variant_id, attribute_id) do update set value = excluded.value`,
    sql`insert into item_attributes (item_id, attribute_id, value, axis_position)
        select ${item}::uuid, ${attribute}::uuid, null, coalesce(max(axis_position) + 1, 0)
        from item_attributes where item_id = ${item}::uuid
        on conflict (item_id, attribute_id) do update set value = null, axis_position = excluded.axis_position
          where item_attributes.axis_position is null`,
  ]
}

/**
 * Axis -> shared, when the database lets the axis go (`axisMayGo`). The item's value is the one every variant has,
 * archived ones included: the same string byte for byte (collation "C"), none empty or missing; otherwise null. Then
 * the variants' values go and the remaining axes close up.
 */
function removeAxis(itemId: Id, attributeId: Id): Statement[] {
  return [
    sql`update item_attributes set axis_position = null, value = (
          select case when count(*) > 0
                       and count(nullif(va.value, '')) = count(*)
                       and min(va.value collate "C") = max(va.value collate "C")
                      then min(va.value collate "C") end
          from variants v
          left join variant_attribute_values va on va.variant_id = v.id and va.attribute_id = ${attributeId}::uuid
          where v.item_id = ${itemId}::uuid
        )
        where item_id = ${itemId}::uuid and attribute_id = ${attributeId}::uuid and axis_position is not null
          and ${axisMayGo(itemId, attributeId)}`,
    deleteVariantValues(itemId, attributeId),
    ...renumberAxes(itemId, []),
  ]
}

export function itemStatements(c: ItemCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'item.create': {
      // One statement: tags and the receipt hang off the row this insert actually created, so replaying the same
      // command (a retry after a timeout) is a no-op as a whole instead of re-adding tags or a second movement.
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
      // Shared attributes only: an axis keeps its null value.
      return [
        sql`insert into item_attributes (item_id, attribute_id, value) values (${c.itemId}, ${c.attributeId}, ${c.value})
            on conflict (item_id, attribute_id) do update set value = excluded.value
              where item_attributes.axis_position is null`,
      ]
    case 'item.removeAttribute':
      // An axis goes as in item.removeAxis, only when the database lets it go; its shared value would go with the link
      // anyway.
      return [
        sql`delete from item_attributes
            where item_id = ${c.itemId} and attribute_id = ${c.attributeId}
              and (axis_position is null or ${axisMayGo(c.itemId, c.attributeId)})`,
        deleteVariantValues(c.itemId, c.attributeId),
        ...renumberAxes(c.itemId, []),
      ]
    case 'item.addAxis':
      return addAxis(c, by)
    case 'item.removeAxis':
      return removeAxis(c.itemId, c.attributeId)
    case 'item.reorderAxes':
      return renumberAxes(c.itemId, c.attributeIds)
  }
}
