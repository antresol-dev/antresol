/**
 * The phone's on-screen keyboard, as far as the sheets need it (AppSheet).
 *
 * The app's viewport is `interactive-widget=resizes-content` (nuxt.config.ts): on Android the keyboard shrinks the layout
 * viewport, so a bottom sheet (fixed, bottom 0, max-height in dvh) sits above the keyboard in one step. What the sheet
 * adds on top:
 * - it opens first and focuses its field after the slide-in (the keyboard never arrives in the middle of a slide);
 * - the field being typed in stays in sight when the viewport changes (revealDelta);
 * - a close puts the keyboard away first, waits for it to go (createKeyboardWatch().closed), then slides out once.
 * The keyboard is detected from window.visualViewport: its height against the tallest it has been at this width.
 */

/** An on-screen keyboard takes at least this much height; the browser's address bar showing or hiding takes less. */
export const KEYBOARD_MIN_HEIGHT = 120

/** How long a close waits for the keyboard to go before sliding out anyway. Android hides it in about 250 ms and the
 *  viewport grows back then, which ends the wait; this is the limit for when it doesn't (another field took focus). */
export const KEYBOARD_SETTLE_MS = 600

/** The part of window.visualViewport used here. */
export interface ViewportLike {
  readonly width: number
  readonly height: number
  addEventListener(type: 'resize', listener: () => void): void
  removeEventListener(type: 'resize', listener: () => void): void
}

export interface KeyboardWatch {
  /** The viewport is shorter than the tallest it has been at this width by a keyboard's height. */
  isOpen(): boolean
  /** Resolves once the keyboard has gone (the viewport grew back), at once when there is none, or after `timeout` ms. */
  closed(timeout: number): Promise<void>
  dispose(): void
}

export function createKeyboardWatch(viewport: ViewportLike): KeyboardWatch {
  let width = viewport.width
  let full = viewport.height
  const waiters = new Set<() => void>()
  const isOpen = (): boolean => full - viewport.height >= KEYBOARD_MIN_HEIGHT
  const onResize = (): void => {
    // Turning the phone starts over: the new width has its own full height.
    if (viewport.width !== width) {
      width = viewport.width
      full = viewport.height
    } else full = Math.max(full, viewport.height)
    if (!isOpen()) for (const done of [...waiters]) done()
  }
  viewport.addEventListener('resize', onResize)
  return {
    isOpen,
    closed(timeout) {
      if (!isOpen()) return Promise.resolve()
      return new Promise((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          waiters.delete(done)
          resolve()
        }
        const timer = setTimeout(done, timeout)
        waiters.add(done)
      })
    },
    dispose() {
      viewport.removeEventListener('resize', onResize)
      for (const done of [...waiters]) done()
    },
  }
}

let shared: KeyboardWatch | null | undefined
/** The app's one watch over window.visualViewport; null where there is none (old browsers, tests). Take it early (a
 *  sheet does so when it is set up): the first call learns the full height from the viewport as it is then. */
export function keyboardWatch(): KeyboardWatch | null {
  if (shared === undefined) {
    const viewport = (globalThis as { visualViewport?: ViewportLike | null }).visualViewport
    shared = viewport ? createKeyboardWatch(viewport) : null
  }
  return shared
}

const NO_KEYBOARD_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** An element that brings up the on-screen keyboard when it has focus: a text field, a text area, editable content. */
export function opensKeyboard(
  el: { tagName: string; type?: string; readOnly?: boolean; isContentEditable?: boolean } | null | undefined,
): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return !el.readOnly
  if (el.tagName === 'INPUT') return !el.readOnly && !NO_KEYBOARD_INPUTS.has((el.type ?? 'text').toLowerCase())
  return false
}

/** How far to scroll a box so a field inside it is in sight with `margin` around it (positive: down). A field taller
 *  than the box shows its top. 0 when it is in sight already. */
export function revealDelta(field: { top: number; bottom: number }, box: { top: number; bottom: number }, margin: number): number {
  const above = field.top - margin - box.top
  if (above < 0) return above
  const below = field.bottom + margin - box.bottom
  return below > 0 ? Math.min(below, above) : 0
}
