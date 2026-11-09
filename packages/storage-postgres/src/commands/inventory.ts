import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type InventoryCommand = Extract<Command, { type: 'inventory.create' | 'inventory.update' }>

export function inventoryStatements(c: InventoryCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'inventory.create':
      return [
        sql`insert into inventories (id, name, description, currency, created_by, updated_by)
            values (${c.id}, ${c.name}, ${c.description}, ${c.currency}, ${actor.device}, ${actor.device})`,
      ]
    case 'inventory.update':
      return [
        sql`update inventories
            set ${updateSet({ name: c.name, description: c.description, updated_by: actor.device })}, updated_at = now()
            where id = ${c.id}`,
      ]
  }
}
