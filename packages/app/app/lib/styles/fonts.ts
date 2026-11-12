/**
 * Font stacks with @nuxt/fonts' metric-matched fallbacks. The module writes "<Family> Fallback: <system font>" faces
 * (size and metrics adjusted so the text does not jump when the web font arrives) for each style family — main.css has
 * one rule per family to make it — but it rewrites only the CSS it sees, not the stacks the styles inject at runtime.
 * So the stacks name them here, right after the family, the way the module itself would. A browser skips a name it has
 * no face for, so a stack still degrades to plain system-ui.
 */

/** The system fonts the module matches the web fonts' metrics against (its fallback faces' suffixes). */
export const FALLBACK_BASES = ['Segoe UI', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans'] as const

/** The families the styles use; main.css names each (test/fonts.test.ts holds the three lists to one another). */
export const FONT_FAMILIES = ['Onest', 'Manrope', 'Inter', 'Rubik', 'Unbounded', 'Exo 2', 'Jost', 'IBM Plex Sans', 'IBM Plex Mono'] as const
export type FontFamily = (typeof FONT_FAMILIES)[number]

/** `'Family', "Family Fallback: …", …` — to be followed by the generic tail. */
export function withFallbacks(family: FontFamily): string {
  return `'${family}', ${FALLBACK_BASES.map((b) => `"${family} Fallback: ${b}"`).join(', ')}`
}

/** A complete stack: the family, its fallback faces, then `tail` (default system-ui, sans-serif). */
export function stack(family: FontFamily, tail = 'system-ui, sans-serif'): string {
  return `${withFallbacks(family)}, ${tail}`
}
