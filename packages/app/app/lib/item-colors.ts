/*
 * How an item's colour is drawn (spec 2026-11-15 minor ideas, "Item colour"). The stored value is a literal hex; the
 * palette is the Appearance accents' light shades. A palette colour has its own dark shade (the accent's pastel), any
 * other hex (written by the MCP) is lifted 55 % toward white. An item without a colour takes one from its id.
 */
import { ACCENTS, ACCENT_NAMES, type AccentName } from './accent'
import { mix } from './styles/color'
import { thumbTone } from './thumb-tone'

export const PALETTE: readonly string[] = ACCENT_NAMES.map((n) => ACCENTS[n].light)

/** The accent a stored colour is, or null when it is not a palette colour. */
export function paletteName(hex: string): AccentName | null {
  return ACCENT_NAMES.find((n) => ACCENTS[n].light === hex) ?? null
}

/** The shade used on dark themes, upper-case. */
export function darkShade(hex: string): string {
  const name = paletteName(hex)
  return name ? ACCENTS[name].dark : mix(hex, '#FFFFFF', 0.55).toUpperCase()
}

export function defaultItemColor(id: string): string {
  return PALETTE[thumbTone(id, PALETTE.length)]!
}

export function itemColor(item: { id: string; color: string | null }): string {
  return item.color ?? defaultItemColor(item.id)
}

/** The custom properties `.colored` picks from (main.css): --c is the light one, or the dark one under `.dark`. */
export function colorVars(hex: string): { '--c-light': string; '--c-dark': string } {
  return { '--c-light': hex, '--c-dark': darkShade(hex) }
}
