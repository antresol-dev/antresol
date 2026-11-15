import type { Actor, Command } from '@antresol/core'
import { INTAKES_REV_KEY } from '../migrator'
import { sql, type Statement } from '../sql'
import { photoAdd, photoReplace } from './photos'
import { movement } from './stock'
import { REFUSE_IF_STALE } from './variants'

type IntakeCommit = Extract<Command, { type: 'intake.commit' }>

/** True unless the check found the intake committed already (a retry): then every statement after it writes nothing.
 *  A transaction-local setting, '' after the transaction that set it ends. */
const PENDING: Statement = { text: `current_setting('antresol.intake_done', true) is distinct from '1'`, params: [] }

/**
 * The check, right after the schema guard: an intake committed already marks the batch done (a retry whose first
 * attempt landed: nothing more is written, whatever the revision); otherwise the batch fails with AN004 (`conflict`)
 * when the source revision is not `baseRev` (the draft was resolved against a copy that is behind) or the draft row's
 * `draft_rev` is not `baseDraftRev` (it was saved since, e.g. on another device: committing would drop those edits).
 * A missing row (the draft deleted elsewhere) passes.
 */
function check(c: IntakeCommit): Statement[] {
  const committed = sql`exists (select 1 from intakes where id = ${c.intakeId}::uuid and status = 'committed')`
  return [
    sql`select set_config('antresol.intake_done', case when ${committed} then '1' else '' end, true),
               set_config('antresol.stale_write',
                          (not ${committed}
                           and ((select value from antresol_meta where key = 'rev') is distinct from ${c.baseRev}::text
                                or exists (select 1 from intakes
                                           where id = ${c.intakeId}::uuid and draft_rev::text <> ${c.baseDraftRev}::text)))::text,
                          true)`,
    REFUSE_IF_STALE,
  ]
}

/** New tags, before the items that name them. */
function newTags(c: IntakeCommit, by: string): Statement[] {
  if (c.newTags.length === 0) return []
  return [
    sql`insert into tags (id, inventory_id, name, created_by, updated_by)
        select t.id, ${c.inventoryId}::uuid, t.name, ${by}, ${by}
        from unnest(${c.newTags.map((t) => t.id)}::uuid[], ${c.newTags.map((t) => t.name)}::text[]) as t(id, name)
        where ${PENDING}
        on conflict (id) do nothing`,
  ]
}

/** New items with their tags and attributes; both hang off the rows this insert created, so a replay adds nothing. */
function newItems(c: IntakeCommit, by: string): Statement[] {
  if (c.newItems.length === 0) return []
  const attributes = c.newItems.flatMap((n) => n.attributes.map((x) => ({ itemId: n.id, ...x })))
  const tags = c.newItems.flatMap((n) => [...new Set(n.tagIds)].map((tagId) => ({ itemId: n.id, tagId })))
  return [
    sql`with ins as (
          insert into items (id, inventory_id, folder_id, name, unit_key, created_by, updated_by)
          select n.id, ${c.inventoryId}::uuid, n.folder_id, n.name, n.unit_key, ${by}, ${by}
          from unnest(${c.newItems.map((n) => n.id)}::uuid[], ${c.newItems.map((n) => n.folderId)}::uuid[],
                      ${c.newItems.map((n) => n.name)}::text[], ${c.newItems.map((n) => n.unitKey)}::text[])
               with ordinality as n(id, folder_id, name, unit_key, ord)
          where ${PENDING}
          order by n.ord
          on conflict (id) do nothing
          returning id
        ), tagged as (
          insert into item_tags (item_id, tag_id)
          select x.item_id, x.tag_id
          from unnest(${tags.map((x) => x.itemId)}::uuid[], ${tags.map((x) => x.tagId)}::uuid[]) as x(item_id, tag_id)
          join ins on ins.id = x.item_id
          on conflict do nothing
          returning 1
        )
        insert into item_attributes (item_id, attribute_id, value, axis_position)
        select x.item_id, x.attribute_id, x.value, x.axis_position
        from unnest(${attributes.map((x) => x.itemId)}::uuid[], ${attributes.map((x) => x.attributeId)}::uuid[],
                    ${attributes.map((x) => x.value)}::text[], ${attributes.map((x) => x.axisPosition)}::int[])
             as x(item_id, attribute_id, value, axis_position)
        join ins on ins.id = x.item_id
        on conflict (item_id, attribute_id) do nothing`,
  ]
}

/** New variants (of new items and of existing ones) after the item's last position, and their values; the values hang
 *  off the rows this insert created. */
function newVariants(c: IntakeCommit, by: string): Statement[] {
  if (c.newVariants.length === 0) return []
  const values = c.newVariants.flatMap((v) => v.values.map((x) => ({ variantId: v.id, ...x })))
  return [
    sql`with ins as (
          insert into variants (id, item_id, position, created_by, updated_by)
          select n.id, n.item_id,
                 (select coalesce(max(position), -1) from variants where item_id = n.item_id)
                   + (row_number() over (partition by n.item_id order by n.ord))::int,
                 ${by}, ${by}
          from unnest(${c.newVariants.map((v) => v.id)}::uuid[], ${c.newVariants.map((v) => v.itemId)}::uuid[])
               with ordinality as n(id, item_id, ord)
          where ${PENDING}
          order by n.ord
          on conflict (id) do nothing
          returning id
        )
        insert into variant_attribute_values (variant_id, attribute_id, value)
        select x.variant_id, x.attribute_id, x.value
        from unnest(${values.map((x) => x.variantId)}::uuid[], ${values.map((x) => x.attributeId)}::uuid[],
                    ${values.map((x) => x.value)}::text[]) as x(variant_id, attribute_id, value)
        join ins on ins.id = x.variant_id
        where x.value <> ''
        on conflict (variant_id, attribute_id) do nothing`,
  ]
}

function unarchive(c: IntakeCommit, by: string): Statement[] {
  if (c.unarchiveVariants.length === 0) return []
  return [
    sql`update variants set archived_at = null, archive_id = null, updated_at = now(), updated_by = ${by}
        where id = any(${c.unarchiveVariants}::uuid[]) and archived_at is not null and ${PENDING}`,
  ]
}

/** The intake becomes committed with its header and lines; a row missing (a draft deleted on another device) is
 *  written committed. Before the receipts, which name it. */
function committed(c: IntakeCommit, by: string): Statement {
  const h = c.header
  return sql`insert into intakes (id, inventory_id, status, shop, order_number, purchased_on, note, draft, lines, draft_rev,
                                  created_by, updated_by, committed_at)
      select ${c.intakeId}::uuid, ${c.inventoryId}::uuid, 'committed', ${h.shop}::text, ${h.orderNumber}::text,
             ${h.purchasedOn}::text, ${h.note}::text, null, ${JSON.stringify(c.lines)}::jsonb, gen_random_uuid(),
             ${by}::text, ${by}::text, now()
      where ${PENDING}
      on conflict (id) do update
        set status = 'committed', shop = excluded.shop, order_number = excluded.order_number,
            purchased_on = excluded.purchased_on, note = excluded.note, draft = null, lines = excluded.lines,
            draft_rev = excluded.draft_rev, updated_at = now(), updated_by = excluded.updated_by,
            committed_at = excluded.committed_at
        where intakes.status = 'draft'`
}

/**
 * intake.commit in one batch (spec 2026-11-13 intakes §7), in order: the check (see `check`), new tags, new items with
 * their tags and attributes, new variants with their values, archived variants back, photos (as photo.add and photo.replace), the
 * intake row committed, one receipt per line marked with the intake, a new intakes revision. Every write after the check
 * waits on PENDING, and every insert is `on conflict (id) do nothing`.
 */
export function intakeStatements(c: IntakeCommit, actor: Actor): Statement[] {
  const by = actor.device
  return [
    ...check(c),
    ...newTags(c, by),
    ...newItems(c, by),
    ...newVariants(c, by),
    ...unarchive(c, by),
    ...c.photos.map((p) =>
      p.replaces === undefined
        ? photoAdd(p, by, PENDING)
        : photoReplace({ ...p, variantId: p.variantId!, replaces: p.replaces }, by, PENDING),
    ),
    committed(c, by),
    ...c.receipts.map((r) =>
      movement(r.movementId, r.itemId, r.variantId, 'receipt', r.quantity, { ...r, intakeId: c.intakeId }, by, PENDING),
    ),
    sql`insert into antresol_meta (key, value) select ${INTAKES_REV_KEY}::text, gen_random_uuid()::text where ${PENDING}
        on conflict (key) do update set value = excluded.value`,
  ]
}
