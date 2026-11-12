import type { AccentName } from './accent'
import { ACCENT_NAMES } from './accent'
import { styleVars } from './styles/apply'
import { STYLE_NAMES, STYLES } from './styles/registry'
import type { Mode, StyleName } from './styles/types'

/** The style picker's cards, in the registry's order (the owner's boards S1–S9). */
export function styleCards(): { name: StyleName; label: string }[] {
  return STYLE_NAMES.map((name) => ({ name, label: STYLES[name].label }))
}

/** The CSS variables of a card's preview scene: the style's tokens for the current theme and accent, put on the card
 *  element alone (custom properties scope to it, so the page keeps its own style). */
export function previewVars(name: StyleName, mode: Mode, accent: AccentName): [string, string][] {
  return styleVars(STYLES[name].build(mode, accent))
}

/** What the accent picker offers: null (hidden, not disabled) for a fixed palette; otherwise "Style default" (null)
 *  first, then every accent. */
export function accentChoices(style: StyleName): (AccentName | null)[] | null {
  return STYLES[style].fixedPalette ? null : [null, ...ACCENT_NAMES]
}
