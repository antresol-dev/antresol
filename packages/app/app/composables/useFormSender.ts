import type { Command } from '@antresol/core'
import { createUnconfirmedSender, type UnconfirmedSender } from '~/lib/unconfirmed'

/**
 * The write of a form to the current inventory, with the unknown outcome handled (createUnconfirmedSender). An unknown
 * outcome leaves the source marked unreachable until it answers again: a retry tries it first (as the return to the
 * app does), so Retry is not refused on the device while the connection is back.
 */
export function useFormSender(shows?: (command: Command) => boolean): UnconfirmedSender {
  const workspace = useWorkspace()
  return createUnconfirmedSender(async (command) => {
    if (workspace.state.readOnly === 'offline') await workspace.syncIfDue().catch(() => {})
    await workspace.apply(command)
  }, shows)
}
