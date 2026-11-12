// FROZEN: the photo inserts of the schema-4 app (src/commands/photos.ts before schema 5), copied verbatim. A command
// without the schema-5 fields (from an older app, or queued before the update) must still write exactly these. Never
// edit: a later change to src/commands/photos.ts is exactly what this copy must not follow.
import type { Actor, Command } from '@antresol/core'
import { sql, type Statement } from '../../src/sql'

export function photoAdd(c: Extract<Command, { type: 'photo.add' }>, actor: Actor): Statement {
  return sql`insert into photos (id, item_id, variant_id, provider, file_id, url, position, created_by)
            values (${c.id}, ${c.itemId}, ${c.variantId}, ${c.provider}, ${c.fileId}, ${c.url},
                    (select coalesce(max(position), -1) + 1 from photos where item_id = ${c.itemId}), ${actor.device})
            on conflict (id) do nothing`
}

export function photoReplace(c: Extract<Command, { type: 'photo.replace' }>, actor: Actor): Statement {
  return sql`with v as (
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
            on conflict (id) do nothing`
}
