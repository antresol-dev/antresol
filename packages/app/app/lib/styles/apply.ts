import type { AccentName } from '../accent'
import { solidOf } from './color'
import { STYLES } from './registry'
import type { Kind, KindState, StyleName, StyleTokens } from './types'

/*
 * Tokens → CSS variables (spec §6; Review Focus 1, 2). Both themes of the style go into one <style id="antresol-style">
 * (`:root{…}` light, `.dark{…}` dark: color-mode puts .dark on <html>), and <html> gets data-style="<name>" for the
 * style's own CSS (assets/css/styles/<name>.css). Applying a style replaces that element: nothing of the previous
 * style stays.
 *
 * Variable names: --st-<key in kebab-case> (popHoverFg → --st-pop-hover-fg, pillRL → --st-pill-r-l); control states
 * --st-<kind>-<n|h|p>-<bg|img|sh|fg|tf> (kinds.primary.h.bg → --st-primary-h-bg, stepSel → --st-step-sel-…); lists
 * --st-<key>-<i> (chips[1] → --st-chips-1; thumbTones[i] → --st-thumb-tone-<i> and --st-thumb-tone-fg-<i>); `led` 1 or 0; `mark` a CSS string or `none`; and, for the high-contrast
 * fallback, opaque versions of the translucent surfaces: --st-{hdr,card,list,photo,sheet}-solid.
 */

export const STYLE_ELEMENT_ID = 'antresol-style'

const KIND_KEYS = new Set(['stepSel', 'ghostSel', 'painted', 'paintedDanger'])
const STATES = ['n', 'h', 'p'] as const
const PROPS = ['bg', 'img', 'sh', 'fg', 'tf'] as const satisfies readonly (keyof KindState)[]
const SOLIDS = ['hdr', 'card', 'list', 'photo', 'sheet'] as const

export function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
}

/** A value that would end the declaration or the rule (or the <style> element), or is not a string at all (a missing
 *  token would otherwise become `--st-x:undefined`), is a bug in a style module. */
function safe(name: string, value: string): string {
  if (typeof value !== 'string' || /[;{}<]/.test(value)) throw new Error(`Style token ${name} must not contain ; { } or <: ${value}`)
  return value
}

/** Every CSS variable of one token set, in token order. */
export function styleVars(t: StyleTokens): [string, string][] {
  const out: [string, string][] = []
  const put = (name: string, value: string) => out.push([name, safe(name, value)])
  const kind = (prefix: string, k: Kind) => {
    for (const s of STATES) for (const p of PROPS) put(`--st-${prefix}-${s}-${p}`, k[s][p])
  }
  for (const [key, value] of Object.entries(t) as [keyof StyleTokens, unknown][]) {
    if (key === 'kinds') {
      for (const [name, k] of Object.entries(t.kinds)) kind(name, k)
    } else if (KIND_KEYS.has(key)) {
      kind(kebab(key), value as Kind)
    } else if (key === 'thumbTones') {
      t.thumbTones.forEach((tone, i) => {
        put(`--st-thumb-tone-${i}`, tone.bg)
        put(`--st-thumb-tone-fg-${i}`, tone.fg)
      })
    } else if (Array.isArray(value)) {
      value.forEach((v: string, i) => put(`--st-${kebab(key)}-${i}`, v))
    } else if (typeof value === 'boolean') {
      put(`--st-${kebab(key)}`, value ? '1' : '0')
    } else if (key === 'mark') {
      put('--st-mark', value === '' ? 'none' : JSON.stringify(value))
    } else {
      put(`--st-${kebab(key)}`, value as string)
    }
  }
  for (const key of SOLIDS) put(`--st-${key}-solid`, solidOf(t[key], t.pageColor))
  return out
}

function block(selector: string, t: StyleTokens): string {
  return `${selector}{${styleVars(t).map(([n, v]) => `${n}:${v}`).join(';')}}`
}

/** The style's CSS: ':root{--st-…}.dark{--st-…}'. */
export function styleCss(name: StyleName, accent: AccentName): string {
  const { build } = STYLES[name]
  return block(':root', build('light', accent)) + block('.dark', build('dark', accent))
}

/** Puts the style on `root` (normally <html>): its one <style id="antresol-style"> replaces any earlier one. */
export function applyStyle(root: HTMLElement, name: StyleName, accent: AccentName): void {
  const doc = root.ownerDocument
  const next = doc.createElement('style')
  next.id = STYLE_ELEMENT_ID
  next.textContent = styleCss(name, accent)
  const previous = doc.getElementById(STYLE_ELEMENT_ID)
  if (previous) previous.replaceWith(next)
  else doc.head.append(next)
  root.setAttribute('data-style', name)
}
