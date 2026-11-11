import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type VariantCommand = Extract<Command, { type: 'variant.createMany' | 'variant.update' | 'variant.setAttribute' }>

// A variant holds values only on the axes its item has in the database when the write runs (core checks the rules
// against the device's copy, which may be stale): a value for any other attribute is not stored. Likewise an item with
// no axis in the database gets no variants (axis_required): the write is skipped, and the revision rules reload the copy.

export function variantStatements(c: VariantCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'variant.createMany': {
      if (c.variants.length === 0) return []
      const ids = c.variants.map((v) => v.id)
      const values = c.variants.flatMap((v) => v.values.map((x) => ({ variantId: v.id, ...x })))
      // One statement: the values hang off the rows this insert actually created, so a replay (a retry after a
      // timeout) neither adds a variant nor overwrites a value changed since.
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
            )
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
  }
}
