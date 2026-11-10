import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { entryInventory, entrySync, INVENTORY_KEY } from '~/lib/history-nav'
import type { InventoryRef } from '~/lib/types'

/** A plain copy: history.state is structured-cloned, and refs from reactive state are proxies.
 *  An object type, not the InventoryRef interface, so it fits Vue Router's HistoryState. */
const plain = (ref: InventoryRef): { sourceId: string; inventoryId: string } => ({
  sourceId: ref.sourceId,
  inventoryId: ref.inventoryId,
})

/**
 * Screen URLs carry no inventory, so every history entry is stamped with the inventory it was opened in.
 * Back or forward onto an entry of another inventory switches to it first; an entry of an inventory that is gone opens
 * the current inventory's root. Vue Router keeps foreign keys of history.state when it rewrites an entry.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()

  router.afterEach(async (to, _from, failure) => {
    if (failure) return
    // This plugin runs before the workspace plugin (alphabetical order); read it lazily.
    await nuxtApp.$workspaceReady
    // A newer navigation landed meanwhile: its own afterEach handles its entry.
    if (router.currentRoute.value.fullPath !== to.fullPath) return

    const workspace = nuxtApp.$workspace
    const { state } = workspace
    const current = state.current
    const action = entrySync(
      entryInventory(window.history.state),
      current,
      state.inventories.map((e) => e.ref),
    )

    if (action.kind === 'stamp' && current) {
      window.history.replaceState({ ...window.history.state, [INVENTORY_KEY]: plain(current) }, '')
    } else if (action.kind === 'switch') {
      workspace.selectInventory(action.ref).catch((e: unknown) => toast.error(nuxtApp.$i18n.t(errorMessageKey(e))))
    } else if (action.kind === 'root') {
      // Restamp the entry while replacing it, or the stale stamp would send this same entry to the root again.
      await router.replace(
        current ? { path: '/', force: true, state: { [INVENTORY_KEY]: plain(current) } } : '/',
      )
    }
  })
})
