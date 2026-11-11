import { describe, expect, it } from 'vitest'
import css from '../app/assets/css/main.css?raw'
import { ACCENTS, type AccentName } from '../app/lib/accent'
import { contrast, cssVars, parseColor, resolveColor, type Vars } from './fixtures/color'

/*
 * The "Hybrid v2" tokens and utilities in main.css (spec 2026-11-11 §4.1, §4.2; Review Focus 4): every text/background
 * pair of both themes at 4.5:1 or better for every accent, the mock-up's shadow numbers, the pointer cursor rule.
 */

const accents = Object.keys(ACCENTS) as AccentName[]
const root = cssVars(css, ':root')
const dark = cssVars(css, '.dark')
const painted = cssVars(css, '.painted')
const paintedDestructive = cssVars(css, '.painted-destructive')

function themeVars(theme: 'light' | 'dark', accent: AccentName): Vars {
  return theme === 'light'
    ? { ...root, 'accent-light': ACCENTS[accent].light }
    : { ...root, ...dark, 'accent-dark': ACCENTS[accent].dark }
}

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
  // Accent-coloured text: the selected row (strongest end of its gradient), links, the soft accent chip.
  ['accent-ink', 'background'],
  ['accent-ink', 'hover'],
  ['accent-ink', 'pressed'],
  ['accent-ink', 'selected-from'],
  ['accent-ink', 'accent-soft'],
  ['accent-soft-foreground', 'accent-soft'],
  ['selected-muted', 'selected-from'],
  // The painted accent button and its fills.
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'hover'],
  ['destructive-foreground', 'destructive'],
  ['warning', 'background'],
  // Tooltip: inverted.
  ['background', 'foreground'],
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
    ] as const)('painted %s button: text on rest, hover and pressed is at least 4.5:1', (_, block) => {
      const local = { ...vars, ...block }
      const fg = resolveColor('paint-foreground', local)
      for (const bg of ['paint', 'paint-hover', 'paint-pressed']) {
        expect(contrast(fg, resolveColor(bg, local), base), bg).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
})

describe('spec values', () => {
  const hex = (name: string, vars: Vars) => resolveColor(name, vars)
  it('light theme', () => {
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
    expect(hex('primary', v)).toEqual(parseColor('#4F46E5'))
    expect(hex('shadow-dark', v)).toEqual(parseColor('rgba(150, 160, 180, 0.29)'))
    expect(hex('shadow-light', v)).toEqual(parseColor('rgba(255, 255, 255, 0.96)'))
  })
  it('dark theme', () => {
    const v = themeVars('dark', 'indigo')
    expect(hex('background', v)).toEqual(parseColor('#24272E'))
    expect(hex('foreground', v)).toEqual(parseColor('#E7E9EE'))
    expect(hex('muted-foreground', v)).toEqual(parseColor('#A0A6B3'))
    expect(hex('icon', v)).toEqual(parseColor('#D4D8E0'))
    expect(hex('divider', v)).toEqual(parseColor('rgba(255, 255, 255, 0.06)'))
    expect(hex('shadow-dark', v)).toEqual(parseColor('rgba(0, 0, 0, 0.55)'))
    expect(hex('shadow-light', v)).toEqual(parseColor('rgba(255, 255, 255, 0.06)'))
    expect(hex('accent', v)).toEqual(parseColor(ACCENTS.indigo.dark))
  })
  it('the accent follows the root variables lib/accent.ts writes', () => {
    expect(resolveColor('accent', themeVars('light', 'teal'))).toEqual(parseColor('#0F766E'))
    expect(resolveColor('accent', themeVars('dark', 'teal'))).toEqual(parseColor(ACCENTS.teal.dark))
  })
})

describe('shadows: the mock-up hybrid2 sh() at depth 0.9, light 1.2, shade 0.7', () => {
  const depth = 0.9
  const light = 1.2
  const shade = 0.7
  const n = (v: number) => Math.round(v * depth * 10) / 10
  /** "dark-x dark-x dark-blur" and "−light-x −light-x light-blur" of sh(x, b). */
  function sh(x: number, b: number): [string, string] {
    const xd = n(x * (0.55 + 0.45 * shade))
    const bd = n(b * (0.6 + 0.4 * shade))
    const xl = n(x * light)
    const bl = n(b * light)
    return [`${xd}px ${xd}px ${bd}px`, `${-xl}px ${-xl}px ${bl}px`]
  }
  const raisedTokens: [string, number, number, string][] = [
    ['raised-shadow', 4, 10, 'shadow-dark'],
    ['raised-shadow-hover', 4, 10, 'shadow-hover'],
    ['raised-sm-shadow', 3, 7, 'shadow-dark'],
    ['raised-sm-shadow-hover', 3, 7, 'shadow-hover'],
    ['pill-shadow', 3, 8, 'shadow-dark'],
    ['pill-shadow-selected', 3, 8, 'shadow-selected'],
    ['card-shadow', 6, 14, 'shadow-dark'],
  ]
  it.each(raisedTokens)('--%s is R(%d, %d)', (token, x, b, darkColour) => {
    const [d, l] = sh(x, b)
    expect(root[token]).toMatch(new RegExp(`^${d} var\\(--${darkColour}\\), ${l} var\\(--shadow-light\\)`))
  })
  const pressedTokens: [string, number, number][] = [
    ['raised-shadow-pressed', 3, 7],
    ['raised-sm-shadow-pressed', 2.5, 6],
    ['step-shadow-pressed', 2, 5],
  ]
  it.each(pressedTokens)('--%s is I(%d, %d) after a zero outer pair', (token, x, b) => {
    const [d, l] = sh(x, b)
    expect(root[token]).toMatch(/^0px 0px 0px transparent, 0px 0px 0px transparent, inset /)
    expect(root[token]).toContain(`inset ${d} var(--shadow-pressed), inset ${l} var(--shadow-light)`)
  })
  it('raised and pressed lists have the same shape, so the change animates', () => {
    const shape = (v: string) => v.split(/,(?![^(]*\))/).map((p) => p.trim().startsWith('inset'))
    for (const [rest, pressed] of [
      ['raised-shadow', 'raised-shadow-pressed'],
      ['raised-shadow-hover', 'raised-shadow-pressed'],
      ['raised-sm-shadow', 'raised-sm-shadow-pressed'],
      ['flat-shadow', 'step-shadow-pressed'],
    ]) {
      expect(shape(root[rest]!), rest).toEqual(shape(root[pressed]!))
    }
  })
  it('light-theme shadow colours: dark 0.42·shade, light 0.8·light', () => {
    expect(root['shadow-dark']).toBe('rgba(150, 160, 180, 0.29)')
    expect(root['shadow-light']).toBe('rgba(255, 255, 255, 0.96)')
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

  const utilities = ['raised', 'raised-sm', 'raised-card', 'painted', 'pressable', 'pill', 'pill-step', 'row-selected']
  it.each(utilities)('.%s is defined and listed in the header comment', (name) => {
    expect(rules(layer('components')).some((r) => r.selectors.split(',').includes(`.${name}`))).toBe(true)
    const header = css.match(/^[\s\S]*?\/\*([\s\S]*?)\*\//)?.[1] ?? ''
    expect(header).toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('reduced motion: no scale and no shadow animation', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*transform: scale\(var\(--active-scale\)\)/)
  })

  it('radius scale: 20 / 14 / 10', () => {
    expect(css).toMatch(/--radius-card:\s*20px/)
    expect(css).toMatch(/--radius-field:\s*14px/)
    expect(css).toMatch(/--radius-chip:\s*10px/)
  })
})
