import { getCurrentScope, onScopeDispose } from 'vue'

export interface LongPressHandlers {
  onPointerdown(e: Pick<PointerEvent, 'pointerType' | 'clientX' | 'clientY'>): void
  onPointermove(e: Pick<PointerEvent, 'clientX' | 'clientY'>): void
  onPointerup(): void
  onPointercancel(): void
  /** Blocks the browser menu while a touch press is held or has just fired. */
  onContextmenu(e: Pick<Event, 'preventDefault'>): void
  /** Swallows the one click that follows a fired long press, so the row link does not open. */
  onClickCapture(e: Pick<Event, 'preventDefault' | 'stopPropagation'>): void
}

/** Touch only. Fires after `delay` (500 ms) unless the finger moves more than `tolerance` (10 px), lifts or the press is cancelled. */
export function useLongPress(
  onLongPress: () => void,
  options: { delay?: number; tolerance?: number } = {},
): LongPressHandlers {
  const delay = options.delay ?? 500
  const tolerance = options.tolerance ?? 10

  let timer: ReturnType<typeof setTimeout> | null = null
  // Where the finger went down while a touch press is held; null otherwise.
  let start: { x: number; y: number } | null = null
  // The press fired and its click (if the browser sends one) is still to come.
  let fired = false

  function stop(): void {
    if (timer !== null) clearTimeout(timer)
    timer = null
    start = null
  }

  if (getCurrentScope()) onScopeDispose(stop)

  return {
    onPointerdown(e) {
      stop()
      // A new press: a click the browser never sent for the last one must not swallow this tap.
      fired = false
      if (e.pointerType !== 'touch') return
      start = { x: e.clientX, y: e.clientY }
      timer = setTimeout(() => {
        timer = null
        fired = true
        onLongPress()
      }, delay)
    },
    onPointermove(e) {
      if (timer === null || start === null) return
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > tolerance) stop()
    },
    onPointerup: stop,
    onPointercancel: stop,
    onContextmenu(e) {
      if (start !== null || fired) e.preventDefault()
    },
    onClickCapture(e) {
      if (!fired) return
      fired = false
      e.preventDefault()
      e.stopPropagation()
    },
  }
}
