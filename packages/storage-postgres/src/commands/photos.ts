import type { Actor, Command } from '@graymatter/core'
import { sql, type Statement } from '../sql'

type PhotoCommand = Extract<Command, { type: 'photo.add' | 'photo.remove' | 'photo.reorder' }>

export function photoStatements(c: PhotoCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'photo.add':
      return [
        sql`insert into photos (id, item_id, variant_id, provider, file_id, url, position, created_by)
            values (${c.id}, ${c.itemId}, ${c.variantId}, ${c.provider}, ${c.fileId}, ${c.url},
                    (select coalesce(max(position), -1) + 1 from photos where item_id = ${c.itemId}), ${actor.device})
            on conflict (id) do nothing`,
      ]
    case 'photo.remove':
      return [sql`delete from photos where id = ${c.id}`]
    case 'photo.reorder':
      return [
        sql`update photos p set position = (o.ord - 1)::int
            from unnest(${c.orderedIds}::uuid[]) with ordinality as o(id, ord)
            where p.id = o.id and p.item_id = ${c.itemId}`,
      ]
  }
}
