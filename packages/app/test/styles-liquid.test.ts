import { stack } from '../app/lib/styles/fonts'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import css from '../app/assets/css/main.css?raw'
import { parseColor, topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode, StyleTokens } from '../app/lib/styles/types'

/*
 * S4 Liquid glass (plan 10 Task 4): the mock-up's `liquid` branch of build() at the style's default accent (blue), and
 * what the app adds around it (spec §5): glass menus (the mock-up's glass()), opaque sheets over the scrim with the
 * card's sheen and rim, blur on panels only.
 */

const { build, defaultAccent } = STYLES.liquid

const SPRING = 'linear(0, 0.53 9%, 0.96 18%, 1.07 24%, 1.04 31%, 1 41%, 0.99 60%, 1)'

/** The owner's mock-up, build('liquid', mode, 'default') (styles-mockup.dc.html), verbatim — except the light accent
 *  button's fill, 95 % instead of 86 % (contrast: white text at 4.24:1 on blue over the wallpaper; lib/styles/liquid.ts). */
const MOCKUP: Record<Mode, Record<string, string>> = {
  light: {
    page: 'radial-gradient(100% 70% at 0% 0%, #c4edee 0%, transparent 65%), radial-gradient(100% 70% at 100% 40%, #c9c2eb 0%, transparent 65%), #dde2ee',
    card: 'linear-gradient(160deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 40%), rgba(255,255,255,0.55)',
    cardR: '26px',
    cardSh: 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.25), inset 0 0 0 1px rgba(255,255,255,0.45), 0 8px 24px -6px rgba(20,24,40,0.18)',
    primary: 'rgba(37,99,235,0.95)',
    pop: 'linear-gradient(165deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.12) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.18) 100%), rgba(255,255,255,0.38)',
    popBlur: 'blur(14px) saturate(180%)',
    popSh: '0 18px 40px -14px rgba(28,32,48,0.35), 0 4px 12px -4px rgba(28,32,48,0.14), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 1px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(255,255,255,0.65)',
    popR: '22px',
    font: `-apple-system, 'SF Pro Text', ${stack('Inter')}`,
    headFont: `-apple-system, 'SF Pro Display', ${stack('Inter')}`,
    stroke: '1.75',
    cap: 'round',
    tr: `background-color 220ms ease, box-shadow 220ms ease, color 220ms ease, transform 420ms ${SPRING}`,
  },
  dark: {
    page: 'radial-gradient(100% 70% at 0% 0%, #225859 0%, transparent 65%), radial-gradient(100% 70% at 100% 40%, #261d4e 0%, transparent 65%), #171d2b',
    card: 'linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%), rgba(28,30,38,0.48)',
    cardR: '26px',
    cardSh: 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.10), 0 8px 24px -6px rgba(0,0,0,0.5)',
    primary: 'rgba(37,99,235,0.86)',
    pop: 'linear-gradient(165deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.05) 100%), rgba(44,48,58,0.48)',
    popBlur: 'blur(16px) saturate(160%)',
    popSh: '0 20px 44px -12px rgba(0,0,0,0.6), 0 4px 12px -4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 1px rgba(255,255,255,0.04), inset 0 0 0 1px rgba(255,255,255,0.12)',
    popR: '22px',
    font: `-apple-system, 'SF Pro Text', ${stack('Inter')}`,
    headFont: `-apple-system, 'SF Pro Display', ${stack('Inter')}`,
    stroke: '1.75',
    cap: 'round',
    tr: `background-color 220ms ease, box-shadow 220ms ease, color 220ms ease, transform 420ms ${SPRING}`,
  },
}

const picked = (t: StyleTokens) => ({
  page: t.page,
  card: t.card,
  cardR: t.cardR,
  cardSh: t.cardSh,
  primary: t.kinds.primary.n.bg,
  pop: t.pop,
  popBlur: t.popBlur,
  popSh: t.popSh,
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

describe.each(['light', 'dark'] as const)('Liquid glass, %s', (mode) => {
  const t = build(mode, defaultAccent)

  it('equals the mock-up at its default accent (blue)', () => {
    expect(defaultAccent).toBe('blue')
    expect(picked(t)).toEqual(MOCKUP[mode])
  })

  it('type: SF Pro (system) with Inter as the fallback; buttons 600, numbers 700', () => {
    expect(t.font).toMatch(/^-apple-system, 'SF Pro Text', 'Inter', /)
    expect(t.labelFont).toBe(t.font)
    expect(t.btnWeight).toBe('600')
    expect(t.numWeight).toBe('700')
  })

  it('glass on every panel: the header, cards and lists, controls; menus are the mock-up\'s glass()', () => {
    expect(t.winBg).toBe('transparent')
    expect(t.winBlur).toBe('none')
    expect(t.hdr).toBe(mode === 'dark' ? 'rgba(20,22,30,0.35)' : 'rgba(255,255,255,0.35)')
    expect(t.hdrBlur).toBe('blur(24px) saturate(180%)')
    expect(t.surfBlur).toBe('blur(20px) saturate(180%)')
    expect(t.ctrlBlur).toBe('blur(12px) saturate(180%)')
    expect(t.popItemR).toBe('14px')
    expect(t.popHoverFg).toBe(t.ink)
  })

  it('capsules: every control, the stepper and chips are fully round', () => {
    for (const r of [t.ibR, t.btnR, t.primR, t.ghostR, t.pillR, t.chipR]) expect(r).toBe('999px')
  })

  it('sheets and dialogs are the card made opaque (they sit over the scrim), keeping its sheen and rim', () => {
    const layers = topLevel(t.sheet)
    expect(layers[0]).toBe(topLevel(t.card)[0])
    expect(baseAlpha(t.sheet)).toBe(1)
    expect(t.sheetBlur).toBe('none')
    expect(t.sheetSh).toBe(t.cardSh)
  })

  it('the springy press: controls scale down with the spring curve', () => {
    expect(t.kinds.ib.p.tf).toBe('scale(0.92)')
    expect(t.kinds.primary.p.tf).toBe('scale(0.96)')
    expect(t.tr).toContain(SPRING)
  })
})

describe('Liquid: softer rims on small controls (plan 12)', () => {
  /** Alphas of a shadow list's inset white lines: [top highlight, ring]. */
  const rimAlphas = (sh: string) =>
    topLevel(sh)
      .filter((x) => x.startsWith('inset'))
      .map((x) => parseColor(/rgba\([^)]*\)/.exec(x)![0])!.a)

  it('dark: icon buttons and the stepper pill wear the card\'s rim at half its alpha', () => {
    const t = build('dark', defaultAccent)
    const card = rimAlphas(t.cardSh)
    expect(card).toEqual([0.22, 0.1])
    for (const sh of [t.kinds.ib.n.sh, t.kinds.ib.h.sh, t.kinds.ib.p.sh, t.pillSh, t.pillSelSh]) {
      expect(rimAlphas(sh)).toEqual(card.map((a) => a / 2))
    }
    // Buttons with a label keep the full rim.
    expect(rimAlphas(t.kinds.btn.n.sh)).toEqual(card)
  })

  it('light keeps one control rim for every control', () => {
    const t = build('light', defaultAccent)
    expect(t.kinds.ib.n.sh).toBe(t.kinds.btn.n.sh)
    expect(t.pillSh).toBe(t.kinds.btn.n.sh)
  })
})

describe('liquid.css', () => {
  const own = (): string => readFileSync(new URL('../app/assets/css/styles/liquid.css', import.meta.url), 'utf8')

  it('is imported once by main.css, before any rule', () => {
    expect(css.match(/@import "\.\/styles\/liquid\.css";/g)).toHaveLength(1)
    expect(css.indexOf('@import "./styles/liquid.css";')).toBeLessThan(css.indexOf('@custom-variant'))
  })

  it('every rule is scoped to [data-style=\'liquid\']', () => {
    const selectors = ruleSelectors(own())
    expect(selectors.length).toBeGreaterThan(0)
    for (const s of selectors) expect(s, s).toMatch(/^\[data-style='liquid'\]/)
  })

  it('sets no padding, margin, gap, width, height or border-width', () => {
    expect(own().replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/(^|[\s;{])(padding|margin|gap|width|height|border-width)\s*:/m)
  })

  it('controls inside a blurred panel do not blur again (no blur on every row)', () => {
    expect(own()).toMatch(/\.surface-list[\s\S]*\.pill[\s\S]*backdrop-filter:\s*none/)
  })
})
