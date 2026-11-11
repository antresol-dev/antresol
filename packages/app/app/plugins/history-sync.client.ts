import type { RouteLocationNormalized } from 'vue-router'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { entryInventory, entrySync, INVENTORY_KEY } from '~/lib/history-nav'
import { inventoryScoped } from '~/lib/shell'
import type { InventoryRef } from '~/lib/types'

/** A plain copy: history.state is structured-cloned, and refs from reactive state are proxies.
 *  An object type, not the InventoryRef interface, so it fits Vue Router's HistoryState. */
const plain = (ref: InventoryRef): { sourceId: string; inventoryId: string } => ({
  sourceId: ref.sourceId,
  inventoryId: ref.inventoryId,
})

/**
 * Screen URLs carry no inventory, so every history entry is stamped with the inventory it was opened in.
 * Back or forward onto an inventory screen's entry of another inventory switches to it first; an entry of an inventory
 * that is gone opens the current inventory's root. Entries of other screens (Settings) are only stamped.
 * Vue Router keeps foreign keys of history.state when it rewrites an entry.
 */
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  // The error's own text is never shown or logged: it may hold a connection string.
  const report = (e: unknown): void => {
    toast.error(nuxtApp.$i18n.t(errorMessageKey(e)))
  }

  /** The workspace start failed and that was reported: every later navigation meets the same rejected start. */
  let startReported = false

  async function sync(to: RouteLocationNormalized): Promise<void> {
    // This plugin runs before the workspace plugin (alphabetical order); read it lazily.
    try {
      await nuxtApp.$workspaceReady
    } catch (e) {
      // Reported once, not again on every navigation after it.
      if (!startReported) report(e)
      startReported = true
      return
    }
    // A newer navigation landed meanwhile: its own afterEach handles its entry.
    if (router.currentRoute.value.fullPath !== to.fullPath) return

    const workspace = nuxtApp.$workspace
    const { state } = workspace
    const current = state.current
    const action = entrySync(
      entryInventory(window.history.state),
      current,
      state.inventories.map((e) => e.ref),
      inventoryScoped(typeof to.name === 'string' ? to.name : null),
    )

    if (action.kind === 'stamp' && current) {
      window.history.replaceState({ ...window.history.state, [INVENTORY_KEY]: plain(current) }, '')
    } else if (action.kind === 'switch') {
      workspace.selectInventory(action.ref).catch(report)
    } else if (action.kind === 'root') {
      // Restamp the entry while replacing it, or the stale stamp would send this same entry to the root again.
      await router.replace(
        current ? { path: '/', force: true, state: { [INVENTORY_KEY]: plain(current) } } : '/',
      )
    }
  }

  router.afterEach(async (to, _from, failure) => {
    if (failure) return
    // A rejected workspace start or replace must not become an unhandled rejection.
    await sync(to).catch(report)
  })
})
