import { watch } from 'vue'
import type { InventoryRef } from '~/lib/types'

const keyOf = (ref: InventoryRef | null): string => (ref ? `${ref.sourceId}\u0000${ref.inventoryId}` : '')

/** Calls `close` when the current inventory changes underneath a shared dialog (history navigation that CloseWatcher
 *  doesn't see: the desktop Back button, Alt+←, a mouse's back button), so a form never writes to the inventory it no
 *  longer shows. While `locked()` is true (its write is running) the dialog stays and is closed once the write is over. */
export function useCloseOnSwitch(
  current: () => InventoryRef | null,
  close: () => void,
  locked: () => boolean = () => false,
): void {
  let stale = false
  const settle = (): void => {
    if (!stale || locked()) return
    stale = false
    close()
  }
  watch(
    () => keyOf(current()),
    () => {
      stale = true
      settle()
    },
  )
  watch(locked, settle)
}
