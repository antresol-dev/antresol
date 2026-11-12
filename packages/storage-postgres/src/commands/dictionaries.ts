import { MAX_PINNED_ATTRIBUTES, type Actor, type Command } from '@antresol/core'
import { sql, updateSet, type Statement } from '../sql'

type DictionaryCommand = Extract<
  Command,
  {
    type:
      | 'tag.create' | 'tag.rename' | 'tag.delete'
      | 'attribute.create' | 'attribute.update' | 'attribute.delete'
      | 'unit.create' | 'unit.update' | 'unit.delete'
  }
>

export function dictionaryStatements(c: DictionaryCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'tag.create':
      return [
        sql`insert into tags (id, inventory_id, name, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.name}, ${by}, ${by})
            on conflict (id) do nothing`,
      ]
    case 'tag.rename':
      return [
        sql`update tags set ${updateSet({ name: c.name, updated_by: by })}, updated_at = now() where id = ${c.id}`,
      ]
    case 'tag.delete':
      return [sql`delete from tags where id = ${c.id}`]
    case 'attribute.create':
      return [
        sql`insert into attributes (id, inventory_id, name, kind, options, unit, si_prefixes, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.name}, ${c.kind}, ${c.options}::text[], ${c.unit}, ${c.siPrefixes},
                    ${by}, ${by})
            on conflict (id) do nothing`,
      ]
    case 'attribute.update': {
      // A new unit or prefix setting changes how values are shown and parsed, never the stored values.
      // A pin keeps to MAX_PINNED_ATTRIBUTES per inventory here too: a copy validated before another device pinned
      // passes core. Writes queue on the revision row (LOCK_REV), so the count sees every pin committed before. Over the
      // limit the pin is skipped and the other fields still apply; an attribute already pinned stays pinned.
      const pin =
        c.pinned === true
          ? sql`, pinned = pinned or (select count(*) from attributes o
                                      where o.inventory_id = attributes.inventory_id and o.pinned
                                        and o.id <> attributes.id) < ${MAX_PINNED_ATTRIBUTES}`
          : c.pinned === false
            ? sql`, pinned = false`
            : sql``
      return [
        sql`update attributes
            set ${updateSet({ name: c.name, options: c.options, unit: c.unit, si_prefixes: c.siPrefixes, updated_by: by })}${pin},
                updated_at = now()
            where id = ${c.id}`,
      ]
    }
    case 'attribute.delete':
      // Not while it is an axis of an item with variants in the database (attribute_is_axis), archived ones included:
      // a copy validated before another device added the variants would take the variants' only distinguishing values.
      // Skipped rather than refused; the command reloads the inventory anyway.
      return [
        sql`delete from attributes
            where id = ${c.id}
              and not exists (select 1 from item_attributes ia
                              where ia.attribute_id = ${c.id} and ia.axis_position is not null
                                and exists (select 1 from variants v where v.item_id = ia.item_id))`,
      ]
    case 'unit.create':
      return [
        sql`insert into custom_units (id, inventory_id, name, symbol, prefix_powers, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.name}, ${c.symbol}, ${c.prefixPowers}::smallint[], ${by}, ${by})
            on conflict (id) do nothing`,
      ]
    case 'unit.update':
      return [
        sql`update custom_units
            set ${updateSet({ name: c.name, symbol: c.symbol, prefix_powers: c.prefixPowers, updated_by: by })},
                updated_at = now()
            where id = ${c.id}`,
      ]
    case 'unit.delete':
      return [sql`delete from custom_units where id = ${c.id}`]
  }
}
