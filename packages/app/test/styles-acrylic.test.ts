import { stack } from '../app/lib/styles/fonts'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import css from '../app/assets/css/main.css?raw'
import { parseColor, topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode, StyleTokens } from '../app/lib/styles/types'

/*
 * S3 Acrylic (plan 10 Task 4): the mock-up's `acrylic` branch of build() at the style's default accent (blue), and what
 * the app adds around it (spec §5): opaque sheets over the scrim, an acrylic header over scrolled content, blur only on
 * the window layer, the header and menus.
 */

const { build, defaultAccent } = STYLES.acrylic

/** The owner's mock-up, build('acrylic', mode, 'default') (styles-mockup.dc.html), verbatim. */
const MOCKUP: Record<Mode, Record<string, string>> = {
  light: {
    page: 'radial-gradient(120% 80% at 0% 0%, #97ddf7 0%, transparent 60%), radial-gradient(100% 70% at 100% 35%, #9d7ef1 0%, transparent 60%), radial-gradient(120% 80% at 30% 100%, #6790e9 0%, transparent 65%), #d3e0fb',
    card: 'rgba(255,255,255,0.7)',
    cardR: '8px',
    cardSh: 'inset 0 0 0 1px rgba(0,0,0,0.0578)',
    primary: '#2563EB',
    pop: 'repeating-radial-gradient(circle at 17% 32%, rgba(0,0,0,0.02) 0 0.6px, transparent 0.6px 2.2px), rgba(252,252,252,0.85)',
    popR: '8px',
    font: `'Segoe UI Variable Text', 'Segoe UI', ${stack('Inter')}`,
    headFont: `'Segoe UI Variable Display', 'Segoe UI', ${stack('Inter')}`,
    stroke: '1.5',
    cap: 'round',
    tr: 'background-color 83ms linear, color 83ms linear, box-shadow 83ms linear',
  },
  dark: {
    page: 'radial-gradient(120% 80% at 0% 0%, #176582 0%, transparent 60%), radial-gradient(100% 70% at 100% 35%, #2a1268 0%, transparent 60%), radial-gradient(120% 80% at 30% 100%, #0f2657 0%, transparent 65%), #050e21',
    card: 'rgba(255,255,255,0.0512)',
    cardR: '8px',
    cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
    primary: '#9DB9F6',
    pop: 'repeating-radial-gradient(circle at 17% 32%, rgba(255,255,255,0.025) 0 0.6px, transparent 0.6px 2.2px), rgba(44,44,44,0.88)',
    popR: '8px',
    font: `'Segoe UI Variable Text', 'Segoe UI', ${stack('Inter')}`,
    headFont: `'Segoe UI Variable Display', 'Segoe UI', ${stack('Inter')}`,
    stroke: '1.5',
    cap: 'round',
    tr: 'background-color 83ms linear, color 83ms linear, box-shadow 83ms linear',
  },
}

const picked = (t: StyleTokens) => ({
  page: t.page,
  card: t.card,
  cardR: t.cardR,
  cardSh: t.cardSh,
  primary: t.kinds.primary.n.bg,
  pop: t.pop,
  popR: t.popR,
  font: t.font,
  headFont: t.headFont,
  stroke: t.stroke,
  cap: t.cap,
  tr: t.tr,
})

/** The selectors of every style rule in a stylesheet (at-rule preludes such as @layer and @media skipped). */
function ruleSelectors(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let start = 0
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '{') {
      const prelude = code.slice(start, i).trim()
      if (!prelude.startsWith('@')) out.push(...topLevel(prelude))
      start = i + 1
    } else if (code[i] === '}' || code[i] === ';') start = i + 1
  }
  return out
}

/** Alpha of a background's bottom layer (its base colour). */
const baseAlpha = (background: string) => parseColor(topLevel(background).at(-1)!)!.a

describe.each(['light', 'dark'] as const)('Acrylic, %s', (mode) => {
  const t = build(mode, defaultAccent)

  it('equals the mock-up at its default accent (blue)', () => {
    expect(defaultAccent).toBe('blue')
    expect(picked(t)).toEqual(MOCKUP[mode])
  })

  it('type: Segoe UI Variable (system) with Inter as the fallback; buttons 600, numbers 700', () => {
    expect(t.font).toContain("'Segoe UI Variable Text', 'Segoe UI', 'Inter', \"Inter Fallback: Segoe UI\"")
    expect(t.labelFont).toBe(t.font)
    expect(t.headWeight).toBe('600')
    expect(t.btnWeight).toBe('600')
    expect(t.numWeight).toBe('700')
  })

  it('Mica: the window layer over the wallpaper; blur only there, on the header and on menus', () => {
    expect(t.winBg).toBe(mode === 'dark' ? 'rgba(32,32,32,0.84)' : 'rgba(243,243,243,0.82)')
    expect(t.winBlur).toBe('blur(60px) saturate(140%)')
    expect(t.popBlur).toBe('blur(30px) saturate(150%)')
    expect(t.hdrBlur).toBe('blur(30px) saturate(150%)')
    // Cards, lists and controls lie on the (already blurred) window: no blur of their own, nor on every row.
    expect(t.surfBlur).toBe('none')
    expect(t.ctrlBlur).toBe('none')
  })

  it('the header is acrylic: translucent enough to read as the window, opaque enough for content scrolled under it', () => {
    expect(baseAlpha(t.hdr)).toBeGreaterThanOrEqual(0.5)
    expect(baseAlpha(t.hdr)).toBeLessThan(1)
  })

  it('sheets and dialogs are the card as it looks on the window, opaque (they sit over the scrim), with no blur', () => {
    expect(baseAlpha(t.sheet)).toBe(1)
    expect(t.sheetBlur).toBe('none')
    expect(t.sheetSh).toBe(t.cardSh)
  })

  it('Fluent\'s selected item: a subtle fill with a 3 px accent pill at the start', () => {
    expect(t.cur).toMatch(/^linear-gradient\((#[0-9A-Fa-f]{6}), \1\) left 2px center \/ 3px 18px no-repeat, rgba\(/)
    expect(t.curM).toBe('0 4px')
  })

  it('fields: the control fill with Fluent\'s darker bottom edge', () => {
    expect(t.fieldSh).toBe(mode === 'dark' ? 'inset 0 1px 0 rgba(255,255,255,0.09)' : 'inset 0 -1px 0 rgba(0,0,0,0.1622)')
  })
})

describe('acrylic.css', () => {
  const own = (): string => readFileSync(new URL('../app/assets/css/styles/acrylic.css', import.meta.url), 'utf8')

  it('is imported once by main.css, before any rule', () => {
    expect(css.match(/@import "\.\/styles\/acrylic\.css";/g)).toHaveLength(1)
    expect(css.indexOf('@import "./styles/acrylic.css";')).toBeLessThan(css.indexOf('@custom-variant'))
  })

  it('every rule is scoped to [data-style=\'acrylic\']', () => {
    const selectors = ruleSelectors(own())
    expect(selectors.length).toBeGreaterThan(0)
    for (const s of selectors) expect(s, s).toMatch(/^\[data-style='acrylic'\]/)
  })

  it('sets no padding, margin, gap, width, height or border-width', () => {
    expect(own().replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s;{])(padding|margin|gap|width|height|border-width)\s*:/m)
  })
})
