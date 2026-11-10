import { onScopeDispose, watch, type Ref } from 'vue'

/** The part of the CloseWatcher API (Chrome 126+) used here; TypeScript's DOM types don't have it yet. */
interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null
  destroy(): void
}
type CloseWatcherConstructor = new () => CloseWatcherLike

/** While `open` is true, the Android back gesture and Esc set it to false through window.CloseWatcher where the browser has it.
 *  No history entries. Without CloseWatcher it does nothing. */
export function useCloseWatcher(open: Ref<boolean>): void {
  let watcher: CloseWatcherLike | null = null

  function release(): void {
    const w = watcher
    watcher = null
    w?.destroy()
  }

  watch(
    open,
    (isOpen) => {
      if (!isOpen) {
        release()
        return
      }
      const Ctor = (globalThis as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher
      if (watcher || typeof Ctor !== 'function') return
      const w = new Ctor()
      w.onclose = () => {
        // The browser has already spent this watcher; a later open makes a new one.
        if (watcher !== w) return
        watcher = null
        open.value = false
      }
      watcher = w
    },
    { immediate: true },
  )

  onScopeDispose(release)
}
