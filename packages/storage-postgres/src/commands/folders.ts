import type { Actor, Command } from '@graymatter/core'
import { sql, updateSet, type Statement } from '../sql'

type FolderCommand = Extract<Command, { type: 'folder.create' | 'folder.update' | 'folder.move' }>

export function folderStatements(c: FolderCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'folder.create':
      return [
        sql`insert into folders (id, inventory_id, parent_id, name, description, created_by, updated_by)
            values (${c.id}, ${c.inventoryId}, ${c.parentId}, ${c.name}, ${c.description}, ${actor.device}, ${actor.device})`,
      ]
    case 'folder.update':
      return [
        sql`update folders
            set ${updateSet({ name: c.name, description: c.description, updated_by: actor.device })}, updated_at = now()
            where id = ${c.id}`,
      ]
    case 'folder.move':
      return [
        sql`update folders
            set ${updateSet({ parent_id: c.parentId, updated_by: actor.device })}, updated_at = now()
            where id = ${c.id}`,
      ]
  }
}
