import { onScopeDispose, watch, type Ref } from 'vue'

/** The part of the CloseWatcher API (Chrome 126+) used here; TypeScript's DOM types don't have it yet. */
interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null
  destroy(): void
}
type CloseWatcherConstructor = new () => CloseWatcherLike

interface Layer {
  open: Ref<boolean>
  watcher: CloseWatcherLike | null
}

// Open layers, bottom to top. Only the top one holds a CloseWatcher: a watcher made without fresh user activation
// (a long press opens its sheet from a timer) joins the group of the one before it, and one back gesture would then
// close both. With a single live watcher there is never a group to join.
const stack: Layer[] = []

function arm(layer: Layer): void {
  const Ctor = (globalThis as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher
  if (layer.watcher || typeof Ctor !== 'function') return
  const w = new Ctor()
  w.onclose = () => {
    // The browser has already spent this watcher; the layer below is armed once this one has closed.
    if (layer.watcher !== w) return
    layer.watcher = null
    layer.open.value = false
  }
  layer.watcher = w
}

function disarm(layer: Layer): void {
  const w = layer.watcher
  layer.watcher = null
  w?.destroy()
}

function push(layer: Layer): void {
  if (stack.includes(layer)) return
  const below = stack.at(-1)
  if (below) disarm(below)
  stack.push(layer)
  arm(layer)
}

function remove(layer: Layer): void {
  const index = stack.indexOf(layer)
  if (index === -1) return
  const wasTop = index === stack.length - 1
  stack.splice(index, 1)
  disarm(layer)
  const top = stack.at(-1)
  if (wasTop && top) arm(top)
}

/** While `open` is true, the Android back gesture and Esc set it to false through window.CloseWatcher where the browser has it.
 *  Only the topmost open layer listens, so one gesture closes one layer. No history entries. Without CloseWatcher it does nothing. */
export function useCloseWatcher(open: Ref<boolean>): void {
  const layer: Layer = { open, watcher: null }
  watch(open, (isOpen) => (isOpen ? push(layer) : remove(layer)), { immediate: true })
  onScopeDispose(() => remove(layer))
}
