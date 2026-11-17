import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import css from '../app/assets/css/main.css?raw'
import { ACCENT_NAMES, ACCENTS, type AccentName } from '../app/lib/accent'
import { styleVars } from '../app/lib/styles/apply'
import { topLevel } from '../app/lib/styles/color'
import { build as neumorphism } from '../app/lib/styles/neumorphism'
import { contrast, cssVars, mixHex, over, parseColor, resolveColor, substitute, type Rgba, type Vars } from './fixtures/color'

/*
 * The "Hybrid v2" look (spec 2026-11-12 §A; Review Focus 5) — since Plan 10 the Neumorphism style: its tokens come
 * from lib/styles/neumorphism.ts and main.css reads them through its semantic variables. Every text/background pair of
 * both themes at 4.5:1 or better for every accent, the mock-up's shadow numbers, the glass menus, the pointer cursor
 * rule, the owner's rulings. (Every style's contrast and Neumorphism's equality with the app before styles:
 * test/styles.test.ts.)
 */

const accents = ACCENT_NAMES
const root = cssVars(css, ':root')
const dark = cssVars(css, '.dark')
const painted = cssVars(css, '.painted')
const paintedDestructive = cssVars(css, '.painted-destructive')
const glass = cssVars(css, '.glass')
const selectedStep = cssVars(css, '.row-selected .pill-step')
/** A value on one line. */
const flat = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()
/** A shadow list's shadows (commas inside color-mix() and var() are not separators). */
const shadows = (list: string): string[] => (list.trim() === 'none' ? [] : topLevel(list))

/** <html> as the app draws it in Neumorphism: main.css's semantic variables over the style's --st-* (lib/styles/apply.ts).
 *  The selected row's gradient ends are given names of their own (--selected-from, --selected-to). */
function themeVars(theme: 'light' | 'dark', accent: AccentName): Vars {
  const st = Object.fromEntries(styleVars(neumorphism(theme, accent)).map(([n, v]) => [n.slice(2), v]))
  const [from, to] = [...st['st-cur']!.matchAll(/rgba\([^)]*\)/g)].map((m) => m[0])
  return { ...root, ...(theme === 'dark' ? dark : {}), ...st, 'selected-from': from!, 'selected-to': to! }
}

/** An element's custom properties: a rule's values are computed against what the element inherits (so a rule may
 *  set --muted-foreground from a token that is itself the root's --muted-foreground). */
function scoped(vars: Vars, block: Vars): Vars {
  return { ...vars, ...Object.fromEntries(Object.entries(block).map(([k, v]) => [k, substitute(v, vars)])) }
}

/** The colour behind a menu: its bottom layer (the gradient above it is a highlight). */
const paneOf = (vars: Vars) => parseColor(topLevel(vars['st-pop']!).at(-1)!)

/** Text token on background token. A translucent background is drawn over --background. */
const pairs: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['foreground', 'hover'],
  ['foreground', 'pressed'],
  ['foreground', 'chip'],
  ['foreground', 'thumb'],
  ['foreground', 'field'],
  ['foreground', 'rail'],
  ['foreground', 'popover'],
  ['foreground', 'accent-soft'],
  ['foreground', 'ghost-pressed'],
  ['foreground', 'selected-from'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'hover'],
  ['muted-foreground', 'pressed'],
  ['muted-foreground', 'chip'],
  ['muted-foreground', 'thumb'],
  ['muted-foreground', 'field'],
  ['muted-foreground', 'rail'],
  ['subtle-foreground', 'background'],
  ['subtle-foreground', 'hover'],
  ['subtle-foreground', 'chip'],
  ['dimmed-foreground', 'background'],
  ['dimmed-foreground', 'hover'],
  ['thumb-foreground', 'thumb'],
  ['icon', 'background'],
  ['icon', 'hover'],
  ['icon', 'rail'],
  // Accent-coloured text: hover and press of every control, the selected row (strongest end of its gradient), links,
  // the soft accent chip, the stepper on a selected row.
  ['accent-ink', 'background'],
  ['accent-ink', 'hover'],
  ['accent-ink', 'pressed'],
  ['accent-ink', 'ghost-hover'],
  ['accent-ink', 'ghost-pressed'],
  ['accent-ink', 'selected-from'],
  ['accent-ink', 'selected-pill'],
  ['accent-ink', 'accent-soft'],
  ['accent-soft-foreground', 'accent-soft'],
  ['selected-muted', 'selected-from'],
  // The accent button (Review Focus 5): soft in the light theme, painted in the dark one; rest, hover, pressed.
  ['st-primary-n-fg', 'st-primary-n-bg'],
  ['st-primary-h-fg', 'st-primary-h-bg'],
  ['st-primary-p-fg', 'st-primary-p-bg'],
  // Painted fills: the accent's paint, checkboxes and progress (primary).
  ['accent-foreground', 'accent-paint'],
  ['primary-foreground', 'primary'],
  ['destructive', 'background'],
  ['destructive', 'hover'],
  ['destructive-foreground', 'destructive'],
  ['warning', 'background'],
  // Tooltip: inverted.
  ['background', 'foreground'],
  ['st-tip-fg', 'st-tip'],
]

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  describe.each(accents)('accent %s', (accent) => {
    const vars = themeVars(theme, accent)
    const base = resolveColor('background', vars)
    it.each(pairs)('%s on %s is at least 4.5:1', (fg, bg) => {
      expect(contrast(resolveColor(fg, vars), resolveColor(bg, vars), base)).toBeGreaterThanOrEqual(4.5)
    })
    it.each([
      ['accent', painted],
      ['destructive', { ...painted, ...paintedDestructive }],
    ] as const)('painted %s surface: text on rest, hover and pressed is at least 4.5:1', (_kind, block) => {
      const local = { ...vars, ...block }
      const fg = resolveColor('paint-foreground', local)
      for (const bg of ['n-bg', 'h-bg', 'p-bg']) {
        expect(contrast(fg, resolveColor(bg, local), base), bg).toBeGreaterThanOrEqual(4.5)
      }
    })
    it('the stepper on a selected row: its text on hover and pressed is at least 4.5:1', () => {
      const local = scoped(vars, selectedStep)
      const pill = resolveColor('selected-pill', local)
      expect(contrast(resolveColor('h-fg', local), resolveColor('h-bg', local), pill), 'hover').toBeGreaterThanOrEqual(4.5)
      expect(contrast(resolveColor('p-fg', local), resolveColor('p-bg', local), pill), 'pressed').toBeGreaterThanOrEqual(4.5)
    })
    it('glass menus: item text, muted and danger text on the glass and on a hovered item are at least 4.5:1', () => {
      // The glass drawn over the page's own colour; a hovered item is the glass hover drawn over that.
      const local = scoped(vars, glass)
      const pane: Rgba = over(paneOf(local), base)
      const hovered: Rgba = over(resolveColor('glass-hover', local), pane)
      for (const fg of ['foreground', 'muted-foreground', 'subtle-foreground', 'destructive', 'accent-ink']) {
        expect(contrast(resolveColor(fg, local), pane), fg).toBeGreaterThanOrEqual(4.5)
      }
      for (const fg of ['glass-hover-foreground', 'muted-foreground', 'destructive']) {
        expect(contrast(resolveColor(fg, local), hovered), `${fg} hovered`).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
})

describe('spec values', () => {
  const hex = (name: string, vars: Vars) => resolveColor(name, vars)
  /** color-mix keeps fractions where the mock-up's mix() rounds to whole channels. */
  const near = (actual: Rgba, expected: string) => {
    const e = parseColor(expected)
    for (const ch of ['r', 'g', 'b'] as const) expect(Math.abs(actual[ch] - e[ch]), `${ch} of ${expected}`).toBeLessThanOrEqual(0.5)
    expect(actual.a).toBeCloseTo(e.a, 3)
  }
  it('light theme: board 7', () => {
    const v = themeVars('light', 'indigo')
    expect(hex('background', v)).toEqual(parseColor('#EDEFF3'))
    expect(hex('surface', v)).toEqual(parseColor('#EDEFF3'))
    expect(hex('foreground', v)).toEqual(parseColor('#1C2030'))
    expect(hex('muted-foreground', v)).toEqual(parseColor('#565D6E'))
    expect(hex('icon', v)).toEqual(parseColor('#2F3442'))
    expect(hex('divider', v)).toEqual(parseColor('#D9DDE5'))
    expect(hex('chip', v)).toEqual(parseColor('#DDE1E8'))
    expect(hex('thumb', v)).toEqual(parseColor('#E2E5EB'))
    expect(hex('accent', v)).toEqual(parseColor('#4F46E5'))
    expect(hex('accent-paint', v)).toEqual(parseColor('#4F46E5'))
    near(hex('accent-ink', v), mixHex('#4F46E5', '#000000', 0.18))
    expect(v['st-seam']).toBe('1px solid rgba(150, 160, 180, 0.22)')
  })
  it('dark theme: board 8, base #2A2E37', () => {
    const v = themeVars('dark', 'indigo')
    expect(hex('background', v)).toEqual(parseColor('#2A2E37'))
    expect(hex('surface', v)).toEqual(parseColor('#2A2E37'))
    expect(hex('foreground', v)).toEqual(parseColor('#E6E8EE'))
    expect(hex('muted-foreground', v)).toEqual(parseColor('#A3A9B6'))
    expect(hex('icon', v)).toEqual(parseColor('#D2D6DE'))
    expect(hex('dimmed-foreground', v)).toEqual(parseColor('#BFC4CE'))
    expect(hex('divider', v)).toEqual(parseColor('#363B46'))
    expect(hex('chip', v)).toEqual(parseColor('#373C48'))
    expect(hex('thumb', v)).toEqual(parseColor('#323743'))
    expect(v['st-seam']).toBe('1px solid rgba(0, 0, 0, 0.28)')
    // The accent is lifted by 12 % white; accent-coloured text is the accent half-way to white.
    expect(hex('accent', v)).toEqual(parseColor(mixHex('#4F46E5', '#FFFFFF', 0.12)))
    near(hex('accent-ink', v), mixHex('#4F46E5', '#FFFFFF', 0.5))
  })
  it('the accent follows the chosen one; the dark theme paints with the light accent', () => {
    expect(resolveColor('accent', themeVars('light', 'teal'))).toEqual(parseColor('#0F766E'))
    expect(resolveColor('accent', themeVars('dark', 'teal'))).toEqual(parseColor(mixHex('#0F766E', '#FFFFFF', 0.12)))
    expect(resolveColor('accent-paint', themeVars('dark', 'teal'))).toEqual(parseColor('#0F766E'))
  })
  it('hover tints the control towards the accent (7 %), press 12 %; flat controls 8 / 16 % light, 16 / 24 % dark', () => {
    const l = themeVars('light', 'indigo')
    const d = themeVars('dark', 'indigo')
    const darkAccent = mixHex(ACCENTS.indigo.light, '#FFFFFF', 0.12)
    near(hex('hover', l), mixHex('#EDEFF3', '#4F46E5', 0.07))
    near(hex('pressed', l), mixHex('#EDEFF3', '#4F46E5', 0.12))
    near(hex('hover', d), mixHex('#2A2E37', darkAccent, 0.07))
    near(hex('pressed', d), mixHex('#2A2E37', darkAccent, 0.12))
    expect(hex('ghost-hover', l).a).toBeCloseTo(0.08)
    expect(hex('ghost-pressed', l).a).toBeCloseTo(0.16)
    expect(hex('ghost-hover', d).a).toBeCloseTo(0.16)
    // The mock-up's 26 % takes accent-ink under 4.5:1 on rose.
    expect(hex('ghost-pressed', d).a).toBeCloseTo(0.24)
  })
  it('the selected row: accent 17 % → 8 % light; 24 % → 12 % dark (the mock-up\'s 26 % fails rose)', () => {
    expect(hex('selected-from', themeVars('light', 'indigo')).a).toBeCloseTo(0.17)
    expect(hex('selected-to', themeVars('light', 'indigo')).a).toBeCloseTo(0.08)
    expect(hex('selected-from', themeVars('dark', 'indigo')).a).toBeCloseTo(0.24)
    expect(hex('selected-to', themeVars('dark', 'indigo')).a).toBeCloseTo(0.12)
  })
})

describe('the accent button (Review Focus 5)', () => {
  it('both themes: painted in the accent itself, white text (plan 12, F5: light was a soft 14 % tint with accent-ink, the dock\'s + hardly stood out; the dark 12 % lift takes white text under 4.5:1)', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const accent of accents) {
        const v = themeVars(mode, accent)
        expect(resolveColor('st-primary-n-bg', v), `${mode} ${accent}`).toEqual(parseColor(ACCENTS[accent].light))
        expect(resolveColor('st-primary-n-fg', v), `${mode} ${accent}`).toEqual(parseColor('#FFFFFF'))
      }
    }
  })
  it('Button "default" and the dock\'s + are the accent button', () => {
    const variants = readFileSync(fileURLToPath(new URL('../app/components/ui/button/index.ts', import.meta.url)), 'utf8')
    expect(variants).toMatch(/default:\s*"accent-button pressable"/)
    const dock = readFileSync(fileURLToPath(new URL('../app/components/MobileDock.vue', import.meta.url)), 'utf8')
    expect(dock).toMatch(/\baccent-button pressable\b/)
  })
})

/** The mock-up's hybrid2 sh(): "dark-x dark-x dark-blur" and "−light-x −light-x light-blur" of R/I(x, b). */
function shadowMaths(depth: number, light: number, shade: number) {
  const n = (v: number) => Math.round(v * depth * 10) / 10
  return {
    n,
    sh(x: number, b: number): [string, string] {
      const xd = n(x * (0.55 + 0.45 * shade))
      const bd = n(b * (0.6 + 0.4 * shade))
      const xl = n(x * light)
      const bl = n(b * light)
      return [`${xd}px ${xd}px ${bd}px`, `${-xl}px ${-xl}px ${bl}px`]
    },
  }
}

const ZERO_OUTERS = ['0px 0px 0px', '0px 0px 0px']
const shadowThemes = [
  // Light (board 7): R() lists the unused inset pair at zero.
  { theme: 'light', depth: 0.7, light: 1.1, shade: 0.7, rest: ['inset 0px 0px 0px', 'inset 0px 0px 0px'] },
  // Dark (board 8): the raised state's spare inset slot is a 1 px top-left rim, the edge catching the light.
  { theme: 'dark', depth: 0.8, light: 0.7, shade: 0.9, rest: ['inset 0.8px 0.8px 0px', 'inset 0px 0px 0px'] },
] as const

/** The first `count` shadows' geometry (colours dropped). */
const geometry = (list: string, count = Infinity) =>
  shadows(flat(list))
    .slice(0, count)
    .map((p) => p.split(' ').filter((w) => w === 'inset' || /^-?[\d.]+(px)?$/.test(w)).join(' '))

describe.each(shadowThemes)('$theme shadows: the mock-up hybrid2 sh() at depth $depth, light $light, shade $shade', (t) => {
  const { sh } = shadowMaths(t.depth, t.light, t.shade)
  const tokens = neumorphism(t.theme, 'indigo')
  const raisedTokens: [string, string, number, number][] = [
    ['btn rest', tokens.kinds.btn.n.sh, 4, 10],
    ['btn hover', tokens.kinds.btn.h.sh, 4, 10],
    ['ib rest', tokens.kinds.ib.n.sh, 3, 7],
    ['ib hover', tokens.kinds.ib.h.sh, 3, 7],
    ['pill', tokens.pillSh, 3, 8],
    ['pill selected', tokens.pillSelSh, 3, 8],
    ['card', tokens.cardSh, 6, 14],
  ]
  it.each(raisedTokens)('%s is R(%d, %d)', (_name, list, x, b) => {
    expect(geometry(list)).toEqual([...sh(x, b), ...t.rest])
  })
  const pressedTokens: [string, string, number, number][] = [
    ['btn pressed', tokens.kinds.btn.p.sh, 3, 7],
    ['ib pressed', tokens.kinds.ib.p.sh, 2.5, 6],
    ['step pressed', tokens.kinds.step.p.sh, 2, 5],
    ['step on a selected row, pressed', tokens.stepSel.p.sh, 2, 5],
  ]
  it.each(pressedTokens)('%s is I(%d, %d) after a zero outer pair', (_name, list, x, b) => {
    const [d, l] = sh(x, b)
    expect(geometry(list)).toEqual([...ZERO_OUTERS, `inset ${d}`, `inset ${l}`])
  })
  it('raised and pressed lists have the same shape, so the change animates', () => {
    const shape = (v: string) => shadows(v).map((p) => p.startsWith('inset'))
    for (const kind of ['btn', 'ib', 'add', 'primary', 'step'] as const) {
      const k = tokens.kinds[kind]
      expect(shape(k.n.sh), `${kind} rest`).toEqual(shape(k.p.sh))
      expect(shape(k.h.sh), `${kind} hover`).toEqual(shape(k.p.sh))
    }
    for (const k of [tokens.stepSel, tokens.painted, tokens.paintedDanger]) {
      expect(shape(k.n.sh)).toEqual(shape(k.p.sh))
      expect(shape(k.h.sh)).toEqual(shape(k.p.sh))
    }
  })
  it('the accent button: R(4, 10) at rest and on hover, I(3, 7) pressed (the light theme\'s soft one, the dark one painted)', () => {
    const [d, l] = sh(4, 10)
    const [pd, pl] = sh(3, 7)
    expect(geometry(tokens.kinds.primary.n.sh, 2)).toEqual([d, l])
    expect(geometry(tokens.kinds.primary.h.sh, 2)).toEqual([d, l])
    expect(geometry(tokens.kinds.primary.p.sh, 4)).toEqual([...ZERO_OUTERS, `inset ${pd}`, `inset ${pl}`])
  })
  it('painted: R(4, 10) and a bevel, I(3, 7) pressed', () => {
    const [d, l] = sh(4, 10)
    const [pd, pl] = sh(3, 7)
    for (const k of [tokens.painted, tokens.paintedDanger]) {
      expect(geometry(k.n.sh, 2)).toEqual([d, l])
      expect(geometry(k.n.sh)).toHaveLength(6)
      expect(geometry(k.p.sh, 4)).toEqual([...ZERO_OUTERS, `inset ${pd}`, `inset ${pl}`])
    }
  })
})

describe('shadow colours', () => {
  /** A shadow's colour. */
  const colour = (list: string, i: number) => parseColor(shadows(list)[i]!.match(/rgba?\([^)]*\)|#\w+|transparent/)![0])
  /** The mock-up's DKa(k): light mix(accent, #1C2030, 0.45) at k·shade; dark mix(accent, black, 0.8) at k·1.5·shade. */
  const tinted = (theme: 'light' | 'dark', accent: AccentName, k: number) => {
    const A = ACCENTS[accent].light
    return theme === 'light'
      ? { rgb: mixHex(A, '#1C2030', 0.45), a: Math.round(k * 0.7 * 1000) / 1000 }
      : { rgb: mixHex(A, '#000000', 0.8), a: Math.round(Math.min(1, k * 1.5 * 0.9) * 1000) / 1000 }
  }
  it('light: dark 0.42·shade, light 0.8·light', () => {
    const t = neumorphism('light', 'indigo')
    expect(colour(t.kinds.btn.n.sh, 0)).toEqual(parseColor('rgba(150, 160, 180, 0.29)'))
    expect(colour(t.kinds.btn.n.sh, 1)).toEqual(parseColor('rgba(255, 255, 255, 0.88)'))
  })
  it('dark: near-black 0.62·shade, a faint top-left light 0.07·light and a rim 0.06·light', () => {
    const t = neumorphism('dark', 'indigo')
    expect(colour(t.kinds.btn.n.sh, 0)).toEqual(parseColor('rgba(6, 8, 12, 0.56)'))
    expect(colour(t.kinds.btn.n.sh, 1)).toEqual(parseColor('rgba(255, 255, 255, 0.049)'))
    expect(colour(t.kinds.btn.n.sh, 2)).toEqual(parseColor('rgba(255, 255, 255, 0.042)'))
  })
  it.each(['light', 'dark'] as const)('%s: hover, pressed and selected shadows take the accent\'s hue', (theme) => {
    for (const accent of accents) {
      const t = neumorphism(theme, accent)
      for (const [name, got, k] of [
        ['hover', colour(t.kinds.btn.h.sh, 0), 0.3],
        ['pressed', colour(t.kinds.btn.p.sh, 2), 0.42],
        ['selected', colour(t.pillSelSh, 0), 0.5],
        ['selected and pressed', colour(t.stepSel.p.sh, 2), 0.55],
      ] as const) {
        const e = tinted(theme, accent, k)
        const want = parseColor(e.rgb)
        for (const ch of ['r', 'g', 'b'] as const) expect(got[ch], `${accent} ${name} ${ch}`).toBeCloseTo(want[ch], 0)
        expect(got.a, `${accent} ${name} alpha`).toBeCloseTo(e.a, 3)
      }
    }
  })
})

describe('glass (menus, select lists, combobox lists)', () => {
  const tokens = {
    light: {
      'glass-bg': 'rgba(255, 255, 255, 0.38)',
      'glass-img':
        'linear-gradient(165deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.12) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.18) 100%)',
      'glass-blur': 'blur(14px) saturate(180%)',
      'glass-border': 'rgba(255, 255, 255, 0.65)',
      'glass-shadow':
        '0 18px 40px -14px rgba(28, 32, 48, 0.35), 0 4px 12px -4px rgba(28, 32, 48, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 1px rgba(255, 255, 255, 0.3), inset 1px 0 0 rgba(255, 255, 255, 0.35)',
      'glass-hover': 'rgba(255, 255, 255, 0.55)',
      'glass-divider': 'rgba(28, 32, 48, 0.1)',
      'glass-danger': '#B91C1C',
    },
    dark: {
      'glass-bg': 'rgba(44, 48, 58, 0.48)',
      'glass-img':
        'linear-gradient(165deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.05) 100%)',
      'glass-blur': 'blur(16px) saturate(160%)',
      'glass-border': 'rgba(255, 255, 255, 0.12)',
      'glass-shadow':
        '0 20px 44px -12px rgba(0, 0, 0, 0.6), 0 4px 12px -4px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 1px rgba(255, 255, 255, 0.04)',
      'glass-hover': 'rgba(255, 255, 255, 0.1)',
      'glass-divider': 'rgba(255, 255, 255, 0.08)',
      'glass-danger': '#FCA5A5',
    },
  }
  it.each(['light', 'dark'] as const)('%s: the mock-up\'s glass tokens', (theme) => {
    const t = neumorphism(theme, 'indigo')
    const layers = topLevel(t.pop)
    const got = {
      'glass-bg': layers.at(-1),
      'glass-img': layers.slice(0, -1).join(', '),
      'glass-blur': t.popBlur,
      'glass-border': t.popBorder,
      'glass-shadow': t.popSh,
      'glass-hover': t.popHover,
      'glass-divider': t.popDiv,
      'glass-danger': t.popDanger,
    }
    expect(got).toEqual(tokens[theme])
    expect(t.popR).toBe('20px')
  })
  it('the glass utility: translucent tinted pane, blur and saturation, a specular rim and a soft shadow', () => {
    const block = /\.glass \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(block).toMatch(/border:\s*1px solid var\(--st-pop-border\)/)
    expect(block).toMatch(/border-radius:\s*var\(--st-pop-r\)/)
    expect(block).toMatch(/background:\s*var\(--st-pop\)/)
    expect(block).toMatch(/(^|[^-])backdrop-filter:\s*var\(--st-pop-blur\)/)
    expect(block).toMatch(/-webkit-backdrop-filter:\s*var\(--st-pop-blur\)/)
    expect(block).toMatch(/box-shadow:\s*var\(--st-pop-sh\)/)
  })
})

describe('glass under prefers-contrast: more', () => {
  it('is the opaque popover surface without blur', () => {
    const media = /@media \(prefers-contrast: more\) \{([\s\S]*?)\n {2}\}\n/.exec(css)?.[1] ?? ''
    expect(media).toMatch(/\.glass \{\s*background:\s*var\(--st-pop-solid\)/)
    expect(root['popover']).toBe('var(--st-pop-solid)')
    const unblurred = /([^{}]*)\{\s*-webkit-backdrop-filter:\s*none;\s*backdrop-filter:\s*none;\s*\}/.exec(media)
    expect(unblurred?.[1]).toMatch(/\.glass,/)
    // Neumorphism's opaque menu is the page's own colour.
    expect(neumorphism('light', 'indigo').popSolid).toBe('#EDEFF3')
    expect(neumorphism('dark', 'indigo').popSolid).toBe('#2A2E37')
  })
})

describe('base styles and utilities', () => {
  /** The body of `@layer <name> { … }`. */
  function layer(name: string): string {
    const start = css.indexOf(`@layer ${name} {`)
    expect(start, `@layer ${name}`).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
    }
    throw new Error('unbalanced')
  }
  const rules = (body: string) =>
    [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/['"\s]/g, ''),
      body: m[2]!,
    }))

  it('a pointer cursor for everything clickable (spec 4.2)', () => {
    const rule = rules(layer('base')).find((r) => /cursor:\s*pointer/.test(r.body))
    expect(rule).toBeDefined()
    for (const s of ['button:not(:disabled)', '[role=button]', 'a[href]', 'summary']) expect(rule!.selectors).toContain(s)
  })

  it('the default cursor for disabled elements', () => {
    const rule = rules(layer('base')).find((r) => /cursor:\s*default/.test(r.body))
    expect(rule?.selectors).toContain(':disabled')
  })

  it('a visible accent focus ring: 2 px, offset 2 px', () => {
    const rule = rules(layer('base')).find((r) => r.selectors === ':focus-visible')
    expect(rule?.body).toMatch(/outline:\s*2px solid var\(--ring\)/)
    expect(rule?.body).toMatch(/outline-offset:\s*2px/)
  })

  const utilities = [
    'raised', 'raised-sm', 'add-tile', 'raised-card', 'accent-button', 'painted', 'pressable', 'pill', 'pill-step', 'row-selected', 'glass',
    'surface-list', 'surface-header', 'surface-sheet', 'surface-tip', 'photo-cover', 'photo-thumb', 'tag-chip', 'screen-title', 'section-label',
    'surface-bar', 'amount', 'btn-text', 'btn-label',
  ]
  it.each(utilities)('.%s is defined and listed in the header comment', (name) => {
    expect(rules(layer('components')).some((r) => r.selectors.split(',').includes(`.${name}`))).toBe(true)
    const header = css.match(/^[\s\S]*?\/\*([\s\S]*?)\*\//)?.[1] ?? ''
    expect(header).toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('reduced motion: no scale and no shadow animation', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*transform: var\(--p-tf\)/)
  })

  it('radius scale: 20 / 14 / 10 (Neumorphism), the style\'s numbers', () => {
    expect(css).toMatch(/--radius-card:\s*var\(--st-card-r\)/)
    expect(css).toMatch(/--radius-field:\s*min\(var\(--st-btn-r\), 26px\)/)
    expect(css).toMatch(/--radius-chip:\s*var\(--st-small-r\)/)
    for (const theme of ['light', 'dark'] as const) {
      const t = neumorphism(theme, 'indigo')
      expect([t.cardR, t.btnR, t.smallR]).toEqual(['20px', '14px', '10px'])
    }
  })
})


/*
 * Every component and page (spec 4.2, acceptance 3): whatever has a click handler is something the pointer rule in
 * main.css covers, so it shows cursor: pointer. The design-system controls keep their shadow, animation and focus
 * outline, and every radius is on the 20 / 14 / 10 / circle scale.
 */
describe('components and pages', () => {
  const appDir = fileURLToPath(new URL('../app', import.meta.url))
  function* vueFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) yield* vueFiles(path)
      else if (name.endsWith('.vue')) yield path
    }
  }
  const files = [...['components', 'pages', 'layouts'].flatMap((d) => [...vueFiles(join(appDir, d))]), join(appDir, 'app.vue')].map(
    (path) => {
      const source = readFileSync(path, 'utf8')
      return { name: relative(appDir, path), source, ast: parse(source).descriptor.template?.ast }
    },
  )
  // The copied shadcn-vue primitives are styled by Task 1 in their own terms (cn() merging, data-state variants).
  // Comments are blanked out (line numbers kept) for the text checks: prose may say "rounded".
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  const appFiles = files
    .filter((f) => !f.name.startsWith('components/ui/'))
    .map((f) => ({ ...f, code: f.source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, blank) }))

  /** Template nodes as far as the checks need them (@vue/compiler-core: 1 element, 6 attribute, 7 directive). */
  interface Prop {
    type: number
    name: string
    value?: { content: string }
    arg?: { content: string }
    exp?: { content: string }
  }
  interface Node {
    type: number
    tag: string
    props: Prop[]
    children?: Node[]
    loc: { start: { line: number } }
  }
  function* elements(node: Node | undefined): Generator<Node> {
    if (!node) return
    if (node.type === 1) yield node
    for (const child of node.children ?? []) yield* elements(child)
  }
  const attr = (n: Node, name: string): string | undefined => n.props.find((p) => p.type === 6 && p.name === name)?.value?.content
  const has = (n: Node, name: string): boolean =>
    n.props.some((p) => (p.type === 6 && p.name === name) || (p.type === 7 && p.name === 'bind' && p.arg?.content === name))
  const onClick = (n: Node): boolean => n.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')
  /** Static class plus the :class expression text. */
  const classText = (n: Node): string =>
    n.props
      .filter((p) => (p.type === 6 && p.name === 'class') || (p.type === 7 && p.name === 'bind' && p.arg?.content === 'class'))
      .map((p) => p.value?.content ?? p.exp?.content ?? '')
      .join(' ')

  // What the base pointer rule covers: tags, `a[href]`, `label[for]` and roles.
  const pointerRule = css.match(/:where\(([^{]*)\)\s*\{\s*cursor:\s*pointer/)?.[1] ?? ''
  const pointerRoles = new Set([...pointerRule.matchAll(/\[role=['"]?([a-z]+)/g)].map((m) => m[1]!))
  // Components that render one of those: Button → <button>, links → a[href], menu items → role="menuitem…".
  const pointerComponents = new Set([
    'Button',
    'NuxtLink',
    'RouterLink',
    'DropdownMenuItem',
    'DropdownMenuCheckboxItem',
    'DropdownMenuRadioItem',
    'SelectItem',
    'ComboboxItem',
  ])

  /** Why a clickable element would show no pointer, or null when the pointer rule covers it. */
  function pointerProblem(n: Node, tag: string, template: Node): string | null {
    if (/(^|[\s'"`])cursor-(default|auto|text|none)\b/.test(classText(n))) return 'a cursor-* utility overrides the pointer'
    if (pointerComponents.has(tag)) return tag === 'Button' && attr(n, 'as') && attr(n, 'as') !== 'button' ? `Button as="${attr(n, 'as')}"` : null
    // createReusableTemplate: <ReuseX> renders the first element inside <DefineX>; attributes and @click fall through.
    const reused = /^Reuse(\w+)$/.exec(tag)
    if (reused) {
      const define = [...elements(template)].find((e) => e.tag === `Define${reused[1]}`)
      const inner = define?.children?.find((c) => c.type === 1)
      return inner ? pointerProblem({ ...inner, props: [...inner.props, ...n.props] }, inner.tag, template) : `<${tag}> without <Define${reused[1]}>`
    }
    if (tag === 'button' || tag === 'summary' || tag === 'select') return null
    if (tag === 'a') return has(n, 'href') ? null : '<a> without href'
    if (tag === 'label') return has(n, 'for') ? null : '<label> without for'
    const role = attr(n, 'role')
    if (!role || !pointerRoles.has(role)) return `<${tag}> without a pointer role`
    if (role === 'button' && !has(n, 'tabindex')) return 'role="button" without tabindex'
    return null
  }

  it('the pointer rule lists roles', () => {
    expect([...pointerRoles]).toEqual(expect.arrayContaining(['button', 'menuitem', 'option']))
  })

  it('every clickable element shows the pointer (spec 4.2)', () => {
    const problems: string[] = []
    for (const f of files) {
      for (const n of elements(f.ast as Node | undefined)) {
        if (!onClick(n)) continue
        // <component :is="a ? X : 'y'">: every tag it can become.
        const is = n.tag === 'component' ? n.props.find((p) => p.type === 7 && p.arg?.content === 'is')?.exp?.content ?? '' : null
        const tags = is === null ? [n.tag] : [...is.matchAll(/'([\w-]+)'|\b([A-Z]\w*)\b/g)].map((m) => m[1] ?? m[2]!)
        for (const tag of tags) {
          const problem = pointerProblem(n, tag, f.ast as Node)
          if (problem) problems.push(`${f.name}:${n.loc.start.line} ${problem}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('design-system controls keep their shadow, animation and focus outline', () => {
    // Raised and painted controls (a Button other than ghost and link is one): focus rings (box-shadow) replace their
    // shadow, outline-none removes the base focus outline, transitions replace their own, hover:bg-* is dead (the
    // states win). Flat pressable controls (ghost): no transitions or hover:bg-* either; an inset ring in a scroll box
    // is fine.
    const raisedClass = /(^|[\s'"`])(raised|raised-sm|add-tile|accent-button|painted|pill-step)($|[\s'"`])/
    const pressableClass = /(^|[\s'"`])pressable($|[\s'"`])/
    const raisedClash = /(^|[\s'"`])(focus-visible:ring[\w-]*|transition(-[\w[\],-]+)?|outline-none|hover:bg-[\w-/]+)($|[\s'"`])/
    const flatClash = /(^|[\s'"`])(transition(-[\w[\],-]+)?|hover:bg-[\w-/]+)($|[\s'"`])/
    const problems: string[] = []
    for (const f of appFiles) {
      // String constants in the script, by name, so a :class that names one is checked too.
      const consts = new Map(
        [...f.code.matchAll(/const (\w+)\s*=\s*\n?\s*(['`])([^'`]*)\2/g)].map((m) => [m[1]!, m[3]!]),
      )
      for (const n of elements(f.ast as Node | undefined)) {
        let text = classText(n)
        for (const [name, value] of consts) if (new RegExp(`\\b${name}\\b`).test(text)) text += ` ${value}`
        const variant = attr(n, 'variant') ?? (has(n, 'variant') ? 'dynamic' : 'default')
        const button = n.tag === 'Button' && variant !== 'link'
        const raised = (button && variant !== 'ghost') || raisedClass.test(text)
        const m = raised ? raisedClash.exec(text) : button || pressableClass.test(text) ? flatClash.exec(text) : null
        if (m) problems.push(`${f.name}:${n.loc.start.line} <${n.tag}> ${m[2]}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('accent-coloured text is text-accent-ink: text-primary fails contrast with some accents', () => {
    const problems = appFiles.flatMap((f) =>
      [...f.code.matchAll(/(^|[\s'"`:])text-primary(?!-)/gm)].map((m) => `${f.name}:${f.code.slice(0, m.index).split('\n').length}`),
    )
    expect(problems).toEqual([])
  })

  it('radii are on the scale: card 20, field 14, chip 10, circle (spec 4.2)', () => {
    const scale = new Set(['card', 'field', 'chip', 'row', 'full', 'none', 'thumb', 'icon', 'fab'])
    const sides = new Set(['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee'])
    const onScale = (value: string): boolean => {
      const parts = value.split('-')
      return parts.length === 1 ? scale.has(parts[0]!) : parts.length === 2 && sides.has(parts[0]!) && scale.has(parts[1]!)
    }
    const problems = appFiles.flatMap((f) =>
      [...f.code.matchAll(/(?<=^|[\s'"`:])rounded(?:-([\w[\].-]+))?(?=$|[\s'"`])/gm)]
        .filter((m) => !m[1] || !onScale(m[1]))
        .map((m) => `${f.name}:${f.code.slice(0, m.index).split('\n').length} ${m[0]}`),
    )
    expect(problems).toEqual([])
  })

  describe('phone pass (the owner, 2026-11-12)', () => {
    const file = (name: string) => {
      const f = files.find((x) => x.name === name)
      if (!f) throw new Error(`no ${name}`)
      return f
    }
    const nodes = (name: string): Node[] => [...elements(file(name).ast as Node | undefined)]
    /** Class text plus the script's string constants it names. */
    function fullClass(name: string, n: Node): string {
      let text = classText(n)
      for (const m of file(name).source.matchAll(/const (\w+)\s*=\s*\n?\s*(['`])([^'`]*)\2/g)) {
        if (new RegExp(`\\b${m[1]}\\b`).test(text)) text += ` ${m[3]}`
      }
      return text
    }
    const raisedClass = /(^|[\s'"`])(raised|raised-sm|add-tile|raised-card|accent-button|painted)($|[\s'"`])/
    const words = (text: string) => new Set(text.split(/[\s'"`,]+/))

    it('the phone header\'s icon buttons are flat (☰ and the screen\'s actions): no raised, no outline Button', () => {
      const menu = nodes('components/ScreenHeader.vue').find((n) =>
        n.props.some((p) => p.type === 7 && p.arg?.content === 'id' && p.exp?.content === 'MENU_BUTTON_ID'),
      )
      expect(menu).toBeDefined()
      expect(fullClass('components/ScreenHeader.vue', menu!)).toMatch(/\bpressable\b/)
      expect(fullClass('components/ScreenHeader.vue', menu!)).not.toMatch(raisedClass)
      for (const name of ['components/FolderActions.vue', 'components/ItemActions.vue']) {
        const compact = nodes(name).filter((n) => /\bcompactButton\b/.test(classText(n)))
        expect(compact.length, name).toBeGreaterThan(0)
        for (const n of compact) {
          expect(n.tag, name).toBe('Button')
          expect(attr(n, 'variant'), `${name}:${n.loc.start.line}`).toBe('ghost')
          expect(fullClass(name, n), `${name}:${n.loc.start.line}`).not.toMatch(raisedClass)
        }
      }
    })

    it('Camera and Gallery (and the desktop "Add photo") are flat bordered buttons, not raised', () => {
      const buttons = nodes('components/PhotoPicker.vue').filter((n) => n.tag === 'Button')
      expect(buttons.length).toBe(3)
      for (const n of buttons) {
        expect(attr(n, 'variant'), `line ${n.loc.start.line}`).toBe('ghost')
        const text = fullClass('components/PhotoPicker.vue', n)
        expect(text).not.toMatch(raisedClass)
        expect(words(text).has('border')).toBe(true)
      }
    })

    it('every sheet has a close button: top right, "Close", 44 px, off while the sheet is locked', () => {
      const close = nodes('components/AppSheet.vue').find((n) =>
        n.props.some((p) => p.type === 7 && p.arg?.content === 'aria-label' && p.exp?.content === "$t('ui.close')"),
      )
      expect(close).toBeDefined()
      expect(close!.tag).toBe('button')
      const text = words(fullClass('components/AppSheet.vue', close!))
      for (const c of ['absolute', 'top-2', 'right-2', 'size-11', 'pressable']) expect(text.has(c), c).toBe(true)
      expect(close!.props.some((p) => p.type === 7 && p.arg?.content === 'disabled' && p.exp?.content === 'locked')).toBe(true)
      expect(onClick(close!)).toBe(true)
      // The photo viewer's own close button moves to the same corner: after the counter.
      const viewer = file('components/PhotoViewer.vue').source
      expect(viewer.indexOf("$t('ui.close')")).toBeGreaterThan(viewer.indexOf("$t('photos.counter'"))
    })

    it('the folder tree sits flat, in the panel and in the drawer: neither concave nor raised', () => {
      for (const name of ['components/TreePanel.vue', 'components/AppNav.vue', 'components/FolderTree.vue']) {
        const shaded = nodes(name).filter((n) => ['concave', 'raised-card'].some((c) => words(classText(n)).has(c)))
        expect(shaded).toEqual([])
      }
      expect(css).not.toMatch(/\.concave\b|--well-shadow/)
    })

    it('Tags & fields: section headings 16 px semibold in the text colour, thinner "Add …" buttons (raised-sm, 40 px), a divider between sections', () => {
      for (const name of ['components/TagsSection.vue', 'components/AttributesSection.vue', 'components/UnitsSection.vue']) {
        const heading = nodes(name).find((n) => n.tag === 'h2')
        expect(heading, name).toBeDefined()
        const h = words(classText(heading!))
        for (const c of ['text-base', 'font-semibold', 'text-foreground']) expect(h.has(c), `${name} ${c}`).toBe(true)
        const add = nodes(name).filter((n) => n.tag === 'Button' && /\braised-sm\b/.test(classText(n)))
        expect(add.length, name).toBe(1)
        expect(attr(add[0]!, 'variant'), name).toBe('ghost')
        expect(words(classText(add[0]!)).has('h-10'), name).toBe(true)
      }
      const sections = nodes('pages/dictionaries.vue').filter((n) => ['AttributesSection', 'UnitsSection'].includes(n.tag))
      expect(sections.length).toBe(2)
      for (const n of sections) expect(words(classText(n)).has('border-t'), n.tag).toBe(true)
    })

    it('Add item: the amount field and its unit select are one height (a passed h-11 wins over the select\'s own)', () => {
      expect(readFileSync(join(appDir, 'components/ui/select/SelectTrigger.vue'), 'utf8')).not.toMatch(/data-\[size=default\]:h-/)
      const amount = nodes('components/AmountField.vue')
      const input = amount.find((n) => n.tag === 'Input')
      const select = amount.find((n) => n.tag === 'SelectTrigger')
      expect(words(classText(input!)).has('h-11')).toBe(true)
      expect(words(classText(select!)).has('h-11')).toBe(true)
    })

    it('a duration never comes without a transition property: alone, it animates every property (sheets grew and shrank with the keyboard)', () => {
      const problems: string[] = []
      for (const f of files) {
        for (const m of f.source.matchAll(/(['"`])([^'"`\n]*\bduration-\d+[^'"`\n]*)\1/g)) {
          if (!/\btransition\b|\btransition-/.test(m[2]!)) problems.push(`${f.name}: ${m[2]}`)
        }
      }
      expect(problems).toEqual([])
    })
  })
})

describe('owner fixes after Plan 8, kept', () => {
  it('dark theme: hover keeps a visible shadow — the mock-up\'s accent-tinted one, not a faded one', () => {
    const colour = (list: string) => parseColor(shadows(list)[0]!.match(/rgba?\([^)]*\)/)![0])
    for (const accent of accents) {
      const t = neumorphism('dark', accent)
      expect(colour(t.kinds.btn.h.sh).a, accent).toBeGreaterThanOrEqual(0.4)
      expect(colour(t.kinds.ib.h.sh).a, accent).toBeGreaterThanOrEqual(0.4)
    }
    // Only the colour of the shadow changes on hover: the same offsets and blur as at rest.
    const t = neumorphism('dark', 'indigo')
    expect(geometry(t.kinds.btn.h.sh)).toEqual(geometry(t.kinds.btn.n.sh))
    expect(geometry(t.kinds.ib.h.sh)).toEqual(geometry(t.kinds.ib.n.sh))
  })
  it('the shadow and the sink of a press share one duration and curve', () => {
    expect(/\.pressable \{[^}]*transition:\s*var\(--st-tr\);/.test(css)).toBe(true)
    for (const theme of ['light', 'dark'] as const) {
      const tr = neumorphism(theme, 'indigo').tr
      const timing = (property: string) => topLevel(tr).find((p) => p.startsWith(`${property} `))?.slice(property.length).trim()
      const shadow = timing('box-shadow')
      const sink = timing('transform')
      expect(shadow).toBeDefined()
      expect(shadow).toBe(sink)
    }
  })
  it('gaps between raised controls stay wider than the shadow reaches', () => {
    // The header's raised actions are 10 px apart; R(3, 7)'s farther side reaches offset + blur.
    for (const t of shadowThemes) {
      const [d, l] = shadowMaths(t.depth, t.light, t.shade).sh(3, 7)
      const reach = (s: string) => {
        const [x, , blur] = s.split(' ').map((p) => Math.abs(parseFloat(p)))
        return x! + blur!
      }
      expect(Math.max(reach(d), reach(l)), t.theme).toBeLessThan(10)
    }
  })
})

describe('Plan 9 owner fixes', () => {
  const app = fileURLToPath(new URL('../app/', import.meta.url))
  const read = (file: string) => readFileSync(join(app, file), 'utf8')
  const glassFiles = [
    'components/ui/dropdown-menu/DropdownMenuContent.vue',
    'components/ui/dropdown-menu/DropdownMenuSubContent.vue',
    'components/ui/select/SelectContent.vue',
    'components/ui/combobox/ComboboxList.vue',
  ]
  it.each(glassFiles)('%s is glass', (file) => {
    const source = read(file)
    expect(source).toMatch(/\bglass\b/)
    // bg-popover or a border utility would paint over the glass (utilities win over the components layer).
    expect(source).not.toMatch(/\b(floating|raised-card|bg-popover)\b/)
  })
  it.each([
    ['components/ui/dropdown-menu/DropdownMenuItem.vue', 'focus'],
    ['components/ui/dropdown-menu/DropdownMenuSubTrigger.vue', 'focus'],
    ['components/ui/dropdown-menu/DropdownMenuCheckboxItem.vue', 'focus'],
    ['components/ui/dropdown-menu/DropdownMenuRadioItem.vue', 'focus'],
    ['components/ui/select/SelectItem.vue', 'focus'],
    ['components/ui/combobox/ComboboxItem.vue', 'data-[highlighted]'],
  ])('%s: a hovered item is a glass highlight', (file, state) => {
    const source = read(file)
    expect(source).toContain(`${state}:bg-(--glass-hover)`)
    expect(source).toContain(`${state}:text-(--glass-hover-foreground)`)
    expect(source).not.toMatch(/\bbg-hover\b/)
  })
  it('separators inside glass use the glass divider', () => {
    for (const file of ['components/ui/dropdown-menu/DropdownMenuSeparator.vue', 'components/ui/select/SelectSeparator.vue', 'components/ui/combobox/ComboboxSeparator.vue']) {
      expect(read(file), file).toContain('bg-(--glass-divider)')
    }
  })
  it('nothing is called floating any more', () => {
    expect(css).not.toMatch(/\.floating\b|--popover-shadow/)
  })
  it('B3: the palette field on the phone has no accent frame', () => {
    expect(read('components/SearchPalette.vue')).not.toMatch(/\bborder-(primary|accent|ring)\b/)
  })
  it('B6: animation classes come from main.css (tw-animate-css is not installed)', () => {
    const dead = /(^|[\s'"`:])(animate-in|animate-out|fade-(in|out)-\d+|zoom-(in|out)-\d+|slide-(in|out)-from-[\w-]+)(?=$|[\s'"`])/m
    const problems: string[] = []
    function* walk(dir: string): Generator<string> {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) yield* walk(path)
        else if (/\.(vue|ts)$/.test(name)) yield path
      }
    }
    for (const path of walk(join(app, 'components'))) {
      const m = dead.exec(readFileSync(path, 'utf8'))
      if (m) problems.push(`${relative(app, path)} ${m[2]}`)
    }
    expect(problems).toEqual([])
  })
  it('B6: tooltips appear and leave with the app\'s own animation', () => {
    const source = read('components/ui/tooltip/TooltipContent.vue')
    expect(source).toMatch(/motion-safe:[\w[\]=-]*:?animate-pop-in/)
    expect(source).toMatch(/data-\[state=closed\]:animate-pop-out/)
    expect(source).toMatch(/motion-reduce:[\w[\]=-]*:?animate-fade-in/)
  })
  it('B6: a tooltip that repeats its trigger\'s name is not announced again as its description', () => {
    // Reka points the trigger's aria-describedby at a copy of the tooltip text; the trigger already says it (aria-label).
    const source = read('components/ui/tooltip/TooltipTrigger.vue')
    expect(source).toMatch(/['"]aria-describedby['"]:\s*undefined/)
  })
})
