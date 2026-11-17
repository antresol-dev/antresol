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

/** New folders, every parent before its children (the command lists them so, and one statement inserts in `ord`
 *  order); with their icon. A replay or a retry finds the ids and adds nothing. */
function newFolders(c: IntakeCommit, by: string): Statement[] {
  if (c.newFolders.length === 0) return []
  return [
    sql`insert into folders (id, inventory_id, parent_id, name, icon, created_by, updated_by)
        select f.id, ${c.inventoryId}::uuid, f.parent_id, f.name, f.icon, ${by}, ${by}
        from unnest(${c.newFolders.map((f) => f.id)}::uuid[], ${c.newFolders.map((f) => f.parentId)}::uuid[],
                    ${c.newFolders.map((f) => f.name)}::text[], ${c.newFolders.map((f) => f.icon ?? null)}::text[])
             with ordinality as f(id, parent_id, name, icon, ord)
        where ${PENDING}
        order by f.ord
        on conflict (id) do nothing`,
  ]
}

/** New custom units, before the items (and attributes) that name them. */
function newUnits(c: IntakeCommit, by: string): Statement[] {
  return (c.newUnits ?? []).map(
    (u) => sql`insert into custom_units (id, inventory_id, name, symbol, prefix_powers, created_by, updated_by)
        select ${u.id}::uuid, ${c.inventoryId}::uuid, ${u.name}::text, ${u.symbol}::text, ${u.prefixPowers}::smallint[], ${by}, ${by}
        where ${PENDING}
        on conflict (id) do nothing`,
  )
}

/** Values appended to existing lists, at the end and in order, the ones the list holds already skipped (a retry that
 *  got past PENDING, or another device's own add, appends nothing twice). */
function appendOptions(c: IntakeCommit, by: string): Statement[] {
  return (c.appendOptions ?? []).map(
    (a) => sql`update attributes
        set options = options || coalesce((select array_agg(x.v order by x.ord)
                                           from unnest(${a.values}::text[]) with ordinality as x(v, ord)
                                           where x.v <> all(attributes.options)), '{}'::text[]),
            updated_at = now(), updated_by = ${by}
        where id = ${a.attributeId}::uuid and ${PENDING}
          and exists (select 1 from unnest(${a.values}::text[]) as y(v) where y.v <> all(attributes.options))`,
  )
}

/** New attributes, before the items that use them. */
function newAttributes(c: IntakeCommit, by: string): Statement[] {
  if (c.newAttributes.length === 0) return []
  return c.newAttributes.map(
    (a) => sql`insert into attributes (id, inventory_id, name, kind, options, unit, si_prefixes, pinned, created_by, updated_by)
        select ${a.id}::uuid, ${c.inventoryId}::uuid, ${a.name}::text, ${a.kind}::text, ${a.options}::text[], ${a.unit}::text,
               ${a.siPrefixes}::boolean, ${a.pinned === true}::boolean, ${by}, ${by}
        where ${PENDING}
        on conflict (id) do nothing`,
  )
}

/** New tags, before the items that name them. */
function newTags(c: IntakeCommit, by: string): Statement[] {
  if (c.newTags.length === 0) return []
  return [
    sql`insert into tags (id, inventory_id, name, color, created_by, updated_by)
        select t.id, ${c.inventoryId}::uuid, t.name, t.color, ${by}, ${by}
        from unnest(${c.newTags.map((t) => t.id)}::uuid[], ${c.newTags.map((t) => t.name)}::text[],
                    ${c.newTags.map((t) => t.color ?? null)}::text[]) as t(id, name, color)
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
          insert into items (id, inventory_id, folder_id, name, description, icon, color, unit_key, created_by, updated_by)
          select n.id, ${c.inventoryId}::uuid, n.folder_id, n.name, n.description, n.icon, n.color, n.unit_key, ${by}, ${by}
          from unnest(${c.newItems.map((n) => n.id)}::uuid[], ${c.newItems.map((n) => n.folderId)}::uuid[],
                      ${c.newItems.map((n) => n.name)}::text[], ${c.newItems.map((n) => n.description)}::text[],
                      ${c.newItems.map((n) => n.icon ?? null)}::text[], ${c.newItems.map((n) => n.color ?? null)}::text[],
                      ${c.newItems.map((n) => n.unitKey)}::text[])
               with ordinality as n(id, folder_id, name, description, icon, color, unit_key, ord)
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
          insert into variants (id, item_id, position, description, created_by, updated_by)
          select n.id, n.item_id,
                 (select coalesce(max(position), -1) from variants where item_id = n.item_id)
                   + (row_number() over (partition by n.item_id order by n.ord))::int,
                 n.description, ${by}, ${by}
          from unnest(${c.newVariants.map((v) => v.id)}::uuid[], ${c.newVariants.map((v) => v.itemId)}::uuid[],
                      ${c.newVariants.map((v) => v.description ?? null)}::text[])
               with ordinality as n(id, item_id, description, ord)
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
  return sql`insert into intakes (id, inventory_id, status, shop, order_number, purchased_on, note, draft, lines, created, draft_rev,
                                  created_by, updated_by, committed_at)
      select ${c.intakeId}::uuid, ${c.inventoryId}::uuid, 'committed', ${h.shop}::text, ${h.orderNumber}::text,
             ${h.purchasedOn}::text, ${h.note}::text, null, ${JSON.stringify(c.lines)}::jsonb,
             ${JSON.stringify(c.created)}::jsonb, gen_random_uuid(),
             ${by}::text, ${by}::text, now()
      where ${PENDING}
      on conflict (id) do update
        set status = 'committed', shop = excluded.shop, order_number = excluded.order_number,
            purchased_on = excluded.purchased_on, note = excluded.note, draft = null, lines = excluded.lines,
            created = excluded.created, draft_rev = excluded.draft_rev, updated_at = now(), updated_by = excluded.updated_by,
            committed_at = excluded.committed_at
        where intakes.status = 'draft'`
}

/**
 * intake.commit in one batch (spec 2026-11-13 intakes §7), in order: the check (see `check`), new folders (parents first, with icons), new units, new attributes (pinned), new tags (coloured), values appended to existing lists, new items with icon, colour,
 * their description, tags and attributes, new variants with their description and values, archived variants back, photos (as photo.add and photo.replace), the
 * intake row committed, one receipt per line marked with the intake, a new intakes revision. Every write after the check
 * waits on PENDING, and every insert is `on conflict (id) do nothing`.
 */
export function intakeStatements(c: IntakeCommit, actor: Actor): Statement[] {
  const by = actor.device
  return [
    ...check(c),
    ...newFolders(c, by),
    ...newUnits(c, by),
    ...newAttributes(c, by),
    ...newTags(c, by),
    ...appendOptions(c, by),
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
