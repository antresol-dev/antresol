import type { Actor, Command } from '@antresol/core'
import { sql, updateSet, type Statement } from '../sql'

type FolderCommand = Extract<Command, { type: 'folder.create' | 'folder.update' | 'folder.move' }>

export function folderStatements(c: FolderCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'folder.create':
      return [
        sql`insert into folders (id, inventory_id, parent_id, name, description, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.parentId}, ${c.name}, ${c.description}, ${actor.device}, ${actor.device})
            on conflict (id) do nothing`,
      ]
    case 'folder.update':
      return [
        sql`update folders
            set ${updateSet({ name: c.name, description: c.description, updated_by: actor.device })}, updated_at = now()
            where id = ${c.id}`,
      ]
    case 'folder.move':
      // Guarded against cycles created by stale snapshots: does nothing if the new parent is the
      // folder itself or one of its descendants.
      return [
        sql`update folders
            set ${updateSet({ parent_id: c.parentId, updated_by: actor.device })}, updated_at = now()
            where id = ${c.id}
              and not exists (
                with recursive sub(id) as (
                  select id from folders where id = ${c.id}
                  union
                  select f.id from folders f join sub on f.parent_id = sub.id
                )
                select 1 from sub where id = ${c.parentId}
              )`,
      ]
  }
}
