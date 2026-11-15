/** Menu swipes on the phone (shell design 6.2): at least 60 px across, 1.5 times more across than down, and a rightward
 *  swipe that starts in the first 24 px is left to Android's system back gesture. */
export const SWIPE = { minDistance: 60, dominance: 1.5, edgeGuard: 24 } as const

/** A finished touch swipe → what to do with the phone menu. 'open': rightward from x ≥ edgeGuard while closed;
 *  'close': leftward while open; null otherwise (short, diagonal or vertical moves; rightward from the edge zone). */
export function swipeAction(
  start: { x: number; y: number },
  end: { x: number; y: number },
  drawerOpen: boolean,
): 'open' | 'close' | null {
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (Math.abs(dx) < SWIPE.minDistance || Math.abs(dx) < SWIPE.dominance * Math.abs(dy)) return null
  if (dx > 0) return !drawerOpen && start.x >= SWIPE.edgeGuard ? 'open' : null
  return drawerOpen ? 'close' : null
}

/** Swipe down to close the phone search palette: at least 80 px down and 1.5 times more down than across. */
export const SWIPE_DOWN = { minDistance: 80, dominance: 1.5 } as const

/** A finished touch move → close the palette? Only when the gesture could not have scrolled the results instead:
 *  `canScrollUp` is whether the results list, at touch start, still had content above to reveal. */
export function swipeDownCloses(start: { x: number; y: number }, end: { x: number; y: number }, canScrollUp: boolean): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  return !canScrollUp && dy >= SWIPE_DOWN.minDistance && dy >= SWIPE_DOWN.dominance * Math.abs(dx)
}

/** Can a touch on a bottom sheet start a swipe-down-to-close? Never against what the finger would do otherwise: not
 *  while the sheet or a scroller inside it is scrolled down (the gesture scrolls it back), not on a slider, an input or
 *  a select (they take the drag themselves), not over a text selection, not on a `locked` sheet, not from 768 px up. */
export function sheetSwipeCanStart(state: {
  phone: boolean
  locked: boolean
  /** Some scroller from the touched element up to the sheet (the sheet itself included) has content above. */
  scrolledDown: boolean
  /** The touch landed on an input, textarea, select, slider or an element that handles its own drag. */
  onControl: boolean
  hasSelection: boolean
}): boolean {
  return state.phone && !state.locked && !state.scrolledDown && !state.onControl && !state.hasSelection
}

/** How far the sheet follows a finger that is `dy` px down: the same 0.6 damping as the palette; never up. */
export function sheetDragOffset(dy: number): number {
  return dy > 0 ? dy * 0.6 : 0
}
