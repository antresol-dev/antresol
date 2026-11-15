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
  source.refresh()
  for (const inventory of await source.inventories()) {
    const intake = (await source.intakes(inventory.id)).find((i) => i.id === id)
    if (!intake) continue
    if (inventory.archivedAt !== null) throw new ToolError(`The inventory "${inventory.name}" is archived; its intakes cannot be changed.`)
    return { inventory, intake }
  }
  throw new ToolError(`No intake with id "${id}". Find ids with list_intakes.`)
}

/** The intake as the tools show it, from a fresh read. */
export async function viewOf(ctx: ToolContext, inventoryId: Id, intakeId: Id): Promise<IntakeView> {
  const source = requireSource(ctx)
  source.refresh()
  const intake = (await source.intakes(inventoryId)).find((i) => i.id === intakeId)
  if (!intake) throw new ToolError('The intake is gone: it may have been deleted in the app.')
  return intakeView(await source.snapshot(inventoryId), intake)
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
    if (intake.status !== 'draft' || intake.draft === null) throw new ToolError(COMMITTED)
    const s = await source.snapshot(inventory.id)
    const result = edit(intake.draft, intake.header, s)
    const saved = await storage.saveIntakeDraft(
      { id: intake.id, inventoryId: inventory.id, header: result.header, content: result.draft },
      intake.draftRev,
      ctx.actor(),
    )
    if (saved.saved) return viewOf(ctx, inventory.id, intake.id)
    if (saved.reason === 'committed') throw new ToolError(COMMITTED)
    intake = saved.current
  }
  throw new ToolError(BEING_EDITED)
}
