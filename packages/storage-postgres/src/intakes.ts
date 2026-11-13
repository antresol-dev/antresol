import type { Actor, Id, IntakeDraftContent, IntakeHeader, SaveIntakeDraftResult } from '@antresol/core'
import type { PgExecutor } from './executor'
import { INTAKES_REV_KEY, LOCK_REV } from './migrator'
import { intakesRevStatement, intakesSql, toRev } from './queries'
import * as rows from './rows'
import { sql, type Statement } from './sql'

// Writes of intakes outside apply (drafts and headers): each is one batch under the revision lock and the schema guard,
// like apply, but without the revision bump: they change only the intakes revision, so other devices do not reload the
// inventory for them (spec 2026-11-13 intakes §4).

/** `with <cte>` + a new intakes revision when the CTE `changed` returned a row. One statement: the bump sees what the
 *  write returned, with no read in JS in between (Neon HTTP runs the batch as one transaction). */
const bumpIfChanged = (changed: Statement): Statement =>
  sql`with changed as (${changed}),
      bump as (
        insert into antresol_meta (key, value) select ${INTAKES_REV_KEY}::text, gen_random_uuid()::text
        where exists (select 1 from changed)
        on conflict (key) do update set value = excluded.value
      )
      select (select draft_rev from changed limit 1) as draft_rev`

/**
 * InventoryStorage.saveIntakeDraft: an upsert by id that writes only when the intake is not committed and either has no
 * row (new here, or deleted on another device: the last write wins) or still has `baseDraftRev` (or `force`). The batch
 * returns what was written, then the row as it is after the write, from which `changed` and `committed` are told apart.
 */
export async function saveIntakeDraft(
  exec: PgExecutor,
  guard: Statement,
  draft: { id: Id; inventoryId: Id; header: IntakeHeader; content: IntakeDraftContent },
  baseDraftRev: string | null,
  actor: Actor,
  force: boolean,
): Promise<SaveIntakeDraftResult> {
  const { id, header: h } = draft
  const by = actor.device
  const write = sql`insert into intakes (id, inventory_id, status, shop, order_number, purchased_on, note, draft, lines,
                                         draft_rev, created_by, updated_by)
      select ${id}::uuid, ${draft.inventoryId}::uuid, 'draft', ${h.shop}::text, ${h.orderNumber}::text, ${h.purchasedOn}::text,
             ${h.note}::text, ${JSON.stringify(draft.content)}::jsonb, null, gen_random_uuid(), ${by}::text, ${by}::text
      where not exists (
        select 1 from intakes
        where id = ${id}::uuid
          and (status <> 'draft' or (draft_rev::text is distinct from ${baseDraftRev}::text and not ${force}::boolean))
      )
      on conflict (id) do update
        set shop = excluded.shop, order_number = excluded.order_number, purchased_on = excluded.purchased_on,
            note = excluded.note, draft = excluded.draft, draft_rev = excluded.draft_rev, updated_at = now(),
            updated_by = excluded.updated_by
        where intakes.status = 'draft'
      returning draft_rev::text as draft_rev`
  const result = await exec.batch([LOCK_REV, guard, bumpIfChanged(write), intakesSql(sql`id = ${id}::uuid`), intakesRevStatement])
  const draftRev = result[2]?.[0]?.draft_rev
  if (typeof draftRev === 'string') return { saved: true, draftRev, intakesRev: toRev(result[4]) }
  const current = result[3]?.[0]
  if (!current) throw new Error('saveIntakeDraft: nothing written and no row')
  if (current.status === 'committed') return { saved: false, reason: 'committed' }
  return { saved: false, reason: 'changed', current: rows.toIntake(current) }
}

/** InventoryStorage.deleteIntakeDraft: drafts only; a committed intake stays. */
export async function deleteIntakeDraft(exec: PgExecutor, guard: Statement, id: Id): Promise<{ intakesRev: string }> {
  const gone = sql`delete from intakes where id = ${id}::uuid and status = 'draft' returning draft_rev::text as draft_rev`
  const result = await exec.batch([LOCK_REV, guard, bumpIfChanged(gone), intakesRevStatement])
  return { intakesRev: toRev(result[3]) }
}

/** InventoryStorage.updateIntakeHeader: a draft's or a committed intake's header; its lines stay as they are. */
export async function updateIntakeHeader(
  exec: PgExecutor,
  guard: Statement,
  id: Id,
  h: IntakeHeader,
  actor: Actor,
): Promise<{ intakesRev: string }> {
  const update = sql`update intakes
      set shop = ${h.shop}::text, order_number = ${h.orderNumber}::text, purchased_on = ${h.purchasedOn}::text,
          note = ${h.note}::text, draft_rev = gen_random_uuid(), updated_at = now(), updated_by = ${actor.device}::text
      where id = ${id}::uuid
      returning draft_rev::text as draft_rev`
  const result = await exec.batch([LOCK_REV, guard, bumpIfChanged(update), intakesRevStatement])
  return { intakesRev: toRev(result[3]) }
}
