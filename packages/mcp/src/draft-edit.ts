import type { Id, Intake, IntakeDraftContent, IntakeHeader, Inventory, InventorySnapshot } from '@antresol/core'
import { requireSource, requireStorage, type ToolContext } from './context'
import { ToolError } from './errors'
import { intakeView, type IntakeView } from './shape'

const READ_ONLY = 'The database was made by a newer version of Antresol and is read-only for this MCP server. Update Antresol MCP.'
const COMMITTED = 'This intake is already committed; only its header can be changed.'
const BEING_EDITED = 'The draft is being edited in the app right now. Try again in a moment.'

/** A draft's or intake's place: the intake as the database holds it now, and its inventory. */
export interface Located {
  inventory: Inventory
  intake: Intake
}

/** The intake by id, read fresh. A read-only source and an archived inventory refuse writes. */
export async function locateIntake(ctx: ToolContext, intakeId: Id): Promise<Located> {
  const source = requireSource(ctx)
  requireStorage(ctx)
  if (source.readOnly) throw new ToolError(READ_ONLY)
  const id = intakeId.trim()
  source.refreshIntakes()
  for (const inventory of await source.inventories()) {
    const intake = (await source.intakes(inventory.id)).find((i) => i.id === id)
    if (!intake) continue
    if (inventory.archivedAt !== null) throw new ToolError(`The inventory "${inventory.name}" is archived; its intakes cannot be changed.`)
    return { inventory, intake }
  }
  throw new ToolError(`No intake with id "${id}". Find ids with list_intakes.`)
}

/** A committed intake takes no draft edit (only its header). */
export function assertDraft(intake: Intake): asserts intake is Intake & { draft: IntakeDraftContent } {
  if (intake.status !== 'draft' || intake.draft === null) throw new ToolError(COMMITTED)
}

/**
 * The intake as the tools show it after a write, from what the write had in hand: the intake as it was read, what was
 * saved and the revision the database gave back. No second listing; the cached lists are dropped so the next read is fresh.
 * `updatedAt` is this machine's clock, the database stamps its own.
 */
export async function viewAfterSave(
  ctx: ToolContext,
  intake: Intake,
  saved: Pick<Intake, 'header' | 'draft'> & { draftRev: string },
  s?: InventorySnapshot,
): Promise<IntakeView> {
  const source = requireSource(ctx)
  source.refreshIntakes()
  const next: Intake = { ...intake, header: saved.header, draft: saved.draft, draftRev: saved.draftRev, updatedAt: ctx.now().toISOString(), updatedBy: ctx.actor().device }
  return intakeView(s ?? (await source.snapshot(intake.inventoryId)), next)
}

/**
 * Changes a draft: reads it fresh, applies `edit` to it, saves it on the revision it read. Never over another device:
 * when the draft changed meanwhile, `edit` is applied once more to what the database holds now; when that changes too,
 * nothing is written and the person is told (a write is never forced). `edit` may run twice, so it must not have effects
 * of its own; it throws ToolError to refuse, and then nothing is written.
 */
export async function editDraft(
  ctx: ToolContext,
  intakeId: Id,
  edit: (draft: IntakeDraftContent, header: IntakeHeader, s: InventorySnapshot) => { draft: IntakeDraftContent; header: IntakeHeader },
): Promise<IntakeView> {
  const storage = requireStorage(ctx)
  const source = requireSource(ctx)
  const located = await locateIntake(ctx, intakeId)
  const { inventory } = located
  let intake = located.intake
  for (let attempt = 0; attempt < 2; attempt++) {
    assertDraft(intake)
    const s = await source.snapshot(inventory.id)
    const result = edit(intake.draft, intake.header, s)
    const saved = await storage.saveIntakeDraft(
      { id: intake.id, inventoryId: inventory.id, header: result.header, content: result.draft },
      intake.draftRev,
      ctx.actor(),
    )
    if (saved.saved) return viewAfterSave(ctx, intake, { header: result.header, draft: result.draft, draftRev: saved.draftRev }, s)
    if (saved.reason === 'committed') throw new ToolError(COMMITTED)
    intake = saved.current
  }
  throw new ToolError(BEING_EDITED)
}
