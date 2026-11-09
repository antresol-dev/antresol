import type { Actor, Command } from '@graymatter/core'
import { sql, type Statement } from '../sql'

type ArchiveCommand = Extract<Command, { type: 'archive' | 'restore' | 'deletePermanently' }>

const TABLES = { inventory: 'inventories', folder: 'folders', item: 'items', variant: 'variants' } as const

/** Recursive CTE `subtree` with the folder and ALL its descendants, regardless of archive state. */
function subtree(folderId: string): Statement {
  return sql`subtree(id) as (
    select id from folders where id = ${folderId}
    union
    select f.id from folders f join subtree s on f.parent_id = s.id
  )`
}

/** Folders to walk up from when restoring: folders and parent items touched by `archive_id = A`. */
function restoreRoots(archiveId: string): Statement {
  return sql`select id as folder_id from folders where archive_id = ${archiveId}
    union
    select folder_id from items where archive_id = ${archiveId} and folder_id is not null
    union
    select i.folder_id from items i join variants v on v.item_id = i.id
      where v.archive_id = ${archiveId} and i.folder_id is not null`
}

export function archiveStatements(c: ArchiveCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'archive': {
      const mark = sql`archived_at = now(), archive_id = ${c.archiveId}, updated_at = now(), updated_by = ${actor.device}`
      if (c.target !== 'folder') {
        return [
          {
            text: `update ${TABLES[c.target]} set ${mark.text} where id = $${mark.params.length + 1} and archived_at is null`,
            params: [...mark.params, c.id],
          },
        ]
      }
      return [
        sql`with recursive ${subtree(c.id)}
            update folders set ${mark} where id in (select id from subtree) and archived_at is null`,
        sql`with recursive ${subtree(c.id)}
            update items set ${mark} where folder_id in (select id from subtree) and archived_at is null`,
      ]
    }
    case 'restore': {
      const clear = sql`archived_at = null, archive_id = null, updated_at = now(), updated_by = ${actor.device}`
      const a = c.archiveId
      // Steps 1 and 2 must run before the rows with archive_id = A are cleared.
      return [
        sql`update items set ${clear}
            where archived_at is not null
              and id in (select item_id from variants where archive_id = ${a})`,
        sql`with recursive up(id) as (
              select folder_id from (${restoreRoots(a)}) r
              union
              select f.parent_id from folders f join up on f.id = up.id where f.parent_id is not null
            )
            update folders set ${clear} where archived_at is not null and id in (select id from up)`,
        sql`update inventories set ${clear} where archive_id = ${a}`,
        sql`update folders set ${clear} where archive_id = ${a}`,
        sql`update items set ${clear} where archive_id = ${a}`,
        sql`update variants set ${clear} where archive_id = ${a}`,
      ]
    }
    case 'deletePermanently': {
      if (c.target === 'folder') {
        const guard = sql`exists (select 1 from folders where id = ${c.id} and archived_at is not null)`
        return [
          sql`with recursive ${subtree(c.id)}
              delete from items where folder_id in (select id from subtree) and ${guard}`,
          sql`with recursive ${subtree(c.id)}
              delete from folders where id in (select id from subtree) and ${guard}`,
        ]
      }
      return [
        {
          text: `delete from ${TABLES[c.target]} where id = $1 and archived_at is not null`,
          params: [c.id],
        },
      ]
    }
  }
}
