// FROZEN: the tag insert before schema 8 (src/commands/dictionaries.ts before migration 0005), copied verbatim. It names
// no `color` column, as every app of schema 7 and older wrote it: it must keep working on a database of any schema, and
// on one that has the column. Never edit.
import type { Actor, Command } from '@antresol/core'
import { sql, type Statement } from '../../src/sql'

export function tagCreate(c: Extract<Command, { type: 'tag.create' }>, actor: Actor): Statement {
  const by = actor.device
  return sql`insert into tags (id, inventory_id, name, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.name}, ${by}, ${by})
            on conflict (id) do nothing`
}
