import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type VariantCommand = Extract<
  Command,
  { type: 'variant.createMany' | 'variant.update' | 'variant.setAttribute' | 'variant.setValues' }
>

// A variant holds values only on the axes its item has in the database when the write runs (core checks the rules
// against the device's copy, which may be stale): a value for any other attribute is not stored. Likewise an item with
// no axis in the database gets no variants (axis_required): the write is skipped, and the revision rules reload the copy.

/**
 * variant.setValues in one statement, every part seeing the database as it was before it:
 * - `x`: the command's values, one per (variant, attribute);
 * - `final`: every variant of the item, archived ones included, as a key of its values on the item's axes in the
 *   database once `x` is applied (a value `x` names wins, null erasing; any other stays), compared as core's
 *   `sameAxisValue` does: text without case and outer spaces, other kinds exactly, an empty value equal only to empty;
 * - `ok`: no variant the command names ends equal to another variant. Core checks this on the device's copy, so it
 *   only fails for a copy that is behind: then nothing is written, and the revision rules reload the copy.
 * Then the erased values go and the others are written, on axes of the item and variants of the item only.
 * Postgres `lower` follows the database's locale (see axisMayGo in items.ts): for non-ASCII text the guard is
 * approximate, and core's check on the device stays the one that decides.
 */
function setValues(c: Extract<Command, { type: 'variant.setValues' }>): Statement[] {
  const values = c.rows.flatMap((r) => r.values.map((x) => ({ variantId: r.variantId, ...x })))
  if (values.length === 0) return []
  const item = c.itemId
  return [
    sql`with x as (
          select distinct on (x.variant_id, x.attribute_id) x.variant_id, x.attribute_id, nullif(btrim(x.value), '') as value
          from unnest(${values.map((x) => x.variantId)}::uuid[], ${values.map((x) => x.attributeId)}::uuid[],
                      ${values.map((x) => x.value)}::text[]) with ordinality as x(variant_id, attribute_id, value, ord)
          order by x.variant_id, x.attribute_id, x.ord desc
        ),
        final as (
          select v.id, array(
            select case when a.kind = 'text' then lower(f.value) else f.value end
            from item_attributes r
            join attributes a on a.id = r.attribute_id
            left join x on x.variant_id = v.id and x.attribute_id = r.attribute_id
            left join variant_attribute_values va on va.variant_id = v.id and va.attribute_id = r.attribute_id
            cross join lateral (
              select nullif(btrim(case when x.attribute_id is not null then x.value else va.value end), '') as value
            ) f
            where r.item_id = ${item}::uuid and r.axis_position is not null
            order by r.attribute_id
          ) as key
          from variants v where v.item_id = ${item}::uuid
        ),
        ok as (
          select not exists (
            select 1 from final f join final g on g.key = f.key and g.id <> f.id
            where f.id in (select variant_id from x)
          ) as ok
        ),
        erased as (
          delete from variant_attribute_values va
          using x, variants v
          where (select ok from ok) and x.value is null
            and va.variant_id = x.variant_id and va.attribute_id = x.attribute_id
            and v.id = x.variant_id and v.item_id = ${item}::uuid
        )
        insert into variant_attribute_values (variant_id, attribute_id, value)
        select x.variant_id, x.attribute_id, x.value
        from x
        join variants v on v.id = x.variant_id and v.item_id = ${item}::uuid
        join item_attributes ia on ia.item_id = v.item_id and ia.attribute_id = x.attribute_id and ia.axis_position is not null
        where (select ok from ok) and x.value is not null
        on conflict (variant_id, attribute_id) do update set value = excluded.value`,
  ]
}

export function variantStatements(c: VariantCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'variant.createMany': {
      if (c.variants.length === 0) return []
      const ids = c.variants.map((v) => v.id)
      const values = c.variants.flatMap((v) => v.values.map((x) => ({ variantId: v.id, ...x })))
      const receipts = c.variants.flatMap((v) => (v.initialReceipt ? [{ variantId: v.id, ...v.initialReceipt }] : []))
      // One statement: the values and the receipts hang off the rows this insert actually created, so a replay (a retry
      // after a timeout) neither adds a variant, nor a second receipt, nor overwrites a value changed since.
      const receipt = receipts.length
        ? sql`, mov as (
              insert into movements (id, inventory_id, item_id, variant_id, kind, quantity, created_by)
              select r.movement_id, i.inventory_id, i.id, ins.id, 'receipt', r.quantity, ${by}
              from unnest(${receipts.map((r) => r.movementId)}::uuid[], ${receipts.map((r) => r.variantId)}::uuid[],
                          ${receipts.map((r) => r.quantity)}::numeric[]) with ordinality as r(movement_id, variant_id, quantity, ord)
              join ins on ins.id = r.variant_id
              join items i on i.id = ${c.itemId}::uuid
              order by r.ord
              on conflict (id) do nothing
            )`
        : sql``
      return [
        sql`with ins as (
              insert into variants (id, item_id, position, created_by, updated_by)
              select n.id, ${c.itemId}::uuid,
                     (select coalesce(max(position), -1) from variants where item_id = ${c.itemId}::uuid) + n.ord::int,
                     ${by}, ${by}
              from unnest(${ids}::uuid[]) with ordinality as n(id, ord)
              where exists (select 1 from item_attributes
                            where item_id = ${c.itemId}::uuid and axis_position is not null)
              on conflict (id) do nothing
              returning id
            )${receipt}
            insert into variant_attribute_values (variant_id, attribute_id, value)
            select x.variant_id, x.attribute_id, x.value
            from unnest(${values.map((x) => x.variantId)}::uuid[], ${values.map((x) => x.attributeId)}::uuid[],
                        ${values.map((x) => x.value)}::text[]) as x(variant_id, attribute_id, value)
            join ins on ins.id = x.variant_id
            join item_attributes ia
              on ia.item_id = ${c.itemId}::uuid and ia.attribute_id = x.attribute_id and ia.axis_position is not null
            where x.value <> ''
            on conflict (variant_id, attribute_id) do nothing`,
      ]
    }
    case 'variant.update':
      return [
        sql`update variants
            set ${updateSet({ description: c.description, updated_by: by })}, updated_at = now()
            where id = ${c.id}`,
      ]
    case 'variant.setAttribute':
      // An empty value is no row.
      if (c.value === null) {
        return [sql`delete from variant_attribute_values where variant_id = ${c.variantId} and attribute_id = ${c.attributeId}`]
      }
      return [
        sql`insert into variant_attribute_values (variant_id, attribute_id, value)
            select v.id, ia.attribute_id, ${c.value}::text
            from variants v
            join item_attributes ia
              on ia.item_id = v.item_id and ia.attribute_id = ${c.attributeId}::uuid and ia.axis_position is not null
            where v.id = ${c.variantId}::uuid
            on conflict (variant_id, attribute_id) do update set value = excluded.value`,
      ]
    case 'variant.setValues':
      return setValues(c)
  }
}
