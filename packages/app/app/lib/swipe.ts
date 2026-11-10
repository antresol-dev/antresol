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
