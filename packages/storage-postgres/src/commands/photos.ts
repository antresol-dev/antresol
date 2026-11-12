import type { Actor, Command } from '@antresol/core'
import { sql, type Statement } from '../sql'

type PhotoCommand = Extract<Command, { type: 'photo.add' | 'photo.replace' | 'photo.remove' | 'photo.reorder' }>

export function photoStatements(c: PhotoCommand, actor: Actor): Statement[] {
  switch (c.type) {
    case 'photo.add':
      return [
        sql`insert into photos (id, item_id, variant_id, provider, file_id, url, position, created_by)
            values (${c.id}, ${c.itemId}, ${c.variantId}, ${c.provider}, ${c.fileId}, ${c.url},
                    (select coalesce(max(position), -1) + 1 from photos where item_id = ${c.itemId}), ${actor.device})
            on conflict (id) do nothing`,
      ]
    case 'photo.replace':
      // One statement, every part seeing the photos as they were: the variant's other photos go and the new one takes
      // the place (position) of the first of them, or the end of the item's photos when it had none. Only for a variant
      // of the item in the database (a copy that is behind may name one deleted since), only when the new id is not
      // some other photo's, and only while the variant still has the photo the command replaces (`replaces`; null: still
      // none): otherwise nothing changes. So a replay finds nothing to do: right after the write the new photo is
      // already there (and the one it replaced gone); long after it, a newer photo that replaced this one stays.
      return [
        sql`with v as (
              select id, item_id from variants
              where id = ${c.variantId}::uuid and item_id = ${c.itemId}::uuid
                and not exists (select 1 from photos
                                where id = ${c.id}::uuid and variant_id is distinct from ${c.variantId}::uuid)
                and case when ${c.replaces}::uuid is null
                         then not exists (select 1 from photos where variant_id = ${c.variantId}::uuid)
                         else exists (select 1 from photos
                                      where id = ${c.replaces}::uuid and variant_id = ${c.variantId}::uuid)
                    end
            ),
            old as (
              select p.id, p.position from photos p join v on p.variant_id = v.id where p.id <> ${c.id}::uuid
            ),
            gone as (
              delete from photos where id in (select id from old)
            )
            insert into photos (id, item_id, variant_id, provider, file_id, url, position, created_by)
            select ${c.id}::uuid, v.item_id, v.id, ${c.provider}, ${c.fileId}, ${c.url},
                   coalesce((select min(position) from old),
                            (select coalesce(max(position), -1) + 1 from photos where item_id = v.item_id)),
                   ${actor.device}
            from v
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
