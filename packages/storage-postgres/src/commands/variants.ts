import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type VariantCommand = Extract<Command, { type: 'variant.createMany' | 'variant.update' | 'variant.setAttribute' }>

export function variantStatements(c: VariantCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'variant.createMany': {
      if (c.variants.length === 0) return []
      const ids = c.variants.map((v) => v.id)
      const names = c.variants.map((v) => v.name)
      return [
        sql`insert into variants (id, item_id, name, position, created_by, updated_by)
            select n.id, ${c.itemId}, n.name,
                   (select coalesce(max(position), -1) from variants where item_id = ${c.itemId}) + n.ord::int,
                   ${by}, ${by}
            from unnest(${ids}::uuid[], ${names}::text[]) with ordinality as n(id, name, ord)
            on conflict (id) do nothing`,
      ]
    }
    case 'variant.update':
      return [
        sql`update variants
            set ${updateSet({ name: c.name, description: c.description, updated_by: by })}, updated_at = now()
            where id = ${c.id}`,
      ]
    case 'variant.setAttribute':
      return [
        sql`insert into variant_attribute_values (variant_id, attribute_id, value)
            values (${c.variantId}, ${c.attributeId}, ${c.value})
            on conflict (variant_id, attribute_id) do update set value = excluded.value`,
      ]
  }
}
