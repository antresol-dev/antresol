import { onScopeDispose, watch, type Ref } from 'vue'

/** The part of the CloseWatcher API (Chrome 126+) used here; TypeScript's DOM types don't have it yet. */
interface CloseWatcherLike {
  onclose: ((event: Event) => void) | null
  oncancel: ((event: Event) => void) | null
  destroy(): void
}
type CloseWatcherConstructor = new () => CloseWatcherLike

interface Layer {
  open: Ref<boolean>
  locked: () => boolean
  watcher: CloseWatcherLike | null
}

// Open layers, bottom to top. Only the top one holds a CloseWatcher: a watcher made without fresh user activation
// (a long press opens its sheet from a timer) joins the group of the one before it, and one back gesture would then
// close both. With a single live watcher there is never a group to join.
const stack: Layer[] = []

// Esc belongs to Reka: every layer here (dialogs, sheets, menus, lists) closes itself on Escape. Chrome then turns the
// same Esc into a close request for the top CloseWatcher, which by that time is the layer below's (Reka closed the top
// layer and the stack armed the next one in the microtask flush), and that layer would close too. So a close request that
// comes from Esc is ignored; the back gesture still closes the top layer. The request follows its keydown in the same
// task, so the flag lives until the next one.
let escapePressed = false
let listening = false

function listenForEscape(): void {
  const target = (globalThis as { window?: Pick<Window, 'addEventListener'> }).window
  if (listening || typeof target?.addEventListener !== 'function') return
  listening = true
  target.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      escapePressed = true
      setTimeout(() => {
        escapePressed = false
      }, 0)
    },
    { capture: true },
  )
}

function arm(layer: Layer): void {
  const Ctor = (globalThis as { CloseWatcher?: CloseWatcherConstructor }).CloseWatcher
  if (layer.watcher || typeof Ctor !== 'function') return
  const w = new Ctor()
  // A locked layer refuses the gesture where the browser lets a close be cancelled (it does with user activation)...
  w.oncancel = (event) => {
    if (escapePressed || layer.locked()) event.preventDefault()
  }
  w.onclose = () => {
    // The browser has already spent this watcher; the layer below is armed once this one has closed.
    if (layer.watcher !== w) return
    layer.watcher = null
    // ...and where it does not, the spent watcher is replaced and the layer stays open. Esc: Reka has done its part.
    if (escapePressed || layer.locked()) {
      arm(layer)
      return
    }
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

/** While `open` is true, the Android back gesture sets it to false through window.CloseWatcher where the browser has it.
 *  Only the topmost open layer listens, so one gesture closes one layer. No history entries. Without CloseWatcher it does nothing.
 *  Close requests from Esc are ignored: Reka closes its own top layer on Esc. While `locked()` is true (a write is running)
 *  the gesture does not close the layer. */
export function useCloseWatcher(open: Ref<boolean>, locked: () => boolean = () => false): void {
  listenForEscape()
  const layer: Layer = { open, locked, watcher: null }
  watch(open, (isOpen) => (isOpen ? push(layer) : remove(layer)), { immediate: true })
  onScopeDispose(() => remove(layer))
}
