/** Width of the folder tree on desktop: px, kept in localStorage (`antresol.treeWidth`). */
export const TREE_WIDTH_DEFAULT = 264
export const TREE_WIDTH_MIN = 200
/** Keyboard step of the separator. */
export const TREE_WIDTH_STEP = 16
const STORAGE_KEY = 'antresol.treeWidth'

/** At most half the window, never below the minimum (a narrow window keeps the minimum). */
export function treeWidthMax(windowWidth: number): number {
  return Math.max(TREE_WIDTH_MIN, Math.floor(windowWidth / 2))
}

/** Whole pixels between the minimum and half the window; garbage falls back to the default. */
export function clampTreeWidth(width: number, windowWidth: number): number {
  if (!Number.isFinite(width)) width = TREE_WIDTH_DEFAULT
  return Math.min(treeWidthMax(windowWidth), Math.max(TREE_WIDTH_MIN, Math.round(width)))
}

/** The saved width, or null when missing, unreadable or the storage throws. */
export function loadTreeWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

/** Failures are ignored: the width is a convenience. null forgets the saved width. */
export function saveTreeWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(Math.round(width)))
  } catch {
    // Private mode or blocked storage: the default applies next time.
  }
}
