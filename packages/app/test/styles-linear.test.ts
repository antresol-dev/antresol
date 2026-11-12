import { stack } from '../app/lib/styles/fonts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES, ACCENTS } from '../app/lib/accent'
import { build } from '../app/lib/styles/linear'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'
import { mixHex, parseColor } from './fixtures/color'

/*
 * S5 Linear (plan 10 Task 3): the mock-up's `linear` branch of build() (styles-mockup.dc.html). Values at the default
 * accent (indigo) are the mock-up's, literally; the shades picked for contrast are listed in the module's header and
 * checked here. Contrast of every pair, theme and accent: test/styles.test.ts.
 */

const INTER = stack('Inter')
const TR = 'background-color 100ms ease, color 100ms ease, box-shadow 100ms ease'

const MOCKUP: Record<Mode, Record<string, string>> = {
  light: {
    page: '#F7F7F8',
    card: '#FFFFFF',
    cardR: '8px',
    cardSh: 'inset 0 0 0 1px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
    primary: '#4F46E5',
    pop: 'rgba(255,255,255,0.92)',
    popR: '8px',
  },
  dark: {
    page: '#08090A',
    card: '#101113',
    cardR: '8px',
    cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
    // Linear keeps its saturated brand fill on dark too.
    primary: '#4F46E5',
    pop: 'rgba(22,23,26,0.94)',
    popR: '8px',
  },
}

describe.each(['light', 'dark'] as const)('Linear, %s, default accent: the mock-up\'s values', (mode) => {
  const t = build(mode, STYLES.linear.defaultAccent)
  const m = MOCKUP[mode]

  it('page, card, its radius and shadow; the primary fill; the menu and its radius', () => {
    expect(STYLES.linear.defaultAccent).toBe('indigo')
    expect([t.page, t.card, t.cardR, t.cardSh]).toEqual([m.page, m.card, m.cardR, m.cardSh])
    expect(t.kinds.primary.n.bg).toBe(m.primary)
    expect([t.pop, t.popR]).toEqual([m.pop, m.popR])
  })

  it('type, icons, motion', () => {
    expect([t.font, t.headFont, t.labelFont]).toEqual([INTER, INTER, INTER])
    expect([t.headWeight, t.headTrack, t.labelSize, t.labelWeight, t.labelCase, t.mark, t.numWeight, t.btnWeight]).toEqual(['600', '-0.015em', '12px', '500', 'none', '', '600', '500'])
    expect([t.stroke, t.cap, t.join]).toEqual(['1.5', 'round', 'round'])
    expect(t.tr).toBe(TR)
  })

  it('hairlines and 6/8 px corners; menus blurred', () => {
    expect([t.ibR, t.btnR, t.primR, t.ghostR, t.popItemR, t.pillR, t.curR, t.thumbR, t.photoR, t.listR, t.chipR]).toEqual(['6px', '6px', '6px', '6px', '6px', '6px', '6px', '6px', '8px', '8px', '999px'])
    expect(t.popBlur).toBe('blur(12px)')
    expect([t.winBlur, t.hdrBlur, t.surfBlur, t.ctrlBlur, t.led]).toEqual(['none', 'none', 'none', 'none', false])
    expect(t.curM).toBe('0 6px')
  })
})

describe('Linear follows the chosen accent', () => {
  it.each(ACCENT_NAMES)('%s: the primary fill is the saturated accent in both themes, white text', (accent) => {
    for (const mode of ['light', 'dark'] as const) {
      const p = build(mode, accent).kinds.primary
      expect(parseColor(p.n.bg)).toEqual(parseColor(ACCENTS[accent].light))
      expect([p.n.fg, p.h.fg, p.p.fg]).toEqual(['#FFFFFF', '#FFFFFF', '#FFFFFF'])
    }
  })
})

describe('Linear: shade picked for contrast (the mock-up\'s amount wherever its text reads at 4.5:1)', () => {
  it('the primary hover lifts the accent 8 % toward white; green 5 % (8 % takes white text to 4.35:1)', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(parseColor(build(mode, 'indigo').kinds.primary.h.bg)).toEqual(parseColor(mixHex('#4F46E5', '#FFFFFF', 0.08)))
      expect(parseColor(build(mode, 'green').kinds.primary.h.bg)).toEqual(parseColor(mixHex('#15803D', '#FFFFFF', 0.05)))
    }
  })
})

describe('Linear: app surfaces the mock-up does not draw', () => {
  it('the neutral chip is a grey, not the surface; fields a stronger hairline; generic lines the card\'s ring', () => {
    const l = build('light', 'indigo')
    const d = build('dark', 'indigo')
    expect([l.chip, l.fieldLine, l.border]).toEqual(['#EFEFF1', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.08)'])
    expect([d.chip, d.fieldLine, d.border]).toEqual(['#202124', 'rgba(255,255,255,0.13)', 'rgba(255,255,255,0.07)'])
    // The tags keep the mock-up's: the surface with a ring.
    expect([l.chips, l.chipSh]).toEqual([['#FFFFFF'], 'inset 0 0 0 1px rgba(0,0,0,0.08)'])
  })
})

describe('linear.css', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const css = () => read('../app/assets/css/styles/linear.css')
  const main = () => read('../app/assets/css/main.css')

  it('is imported once by main.css', () => {
    expect(main().match(/@import "\.\/styles\/linear\.css";/g)).toHaveLength(1)
  })

  it('has no rules of its own: the dark drawer\'s edge is main.css\'s for every style, and nothing else is left', () => {
    const selectors = [...css().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].map((s) => s[1]!.trim())
    expect(selectors).toEqual([])
  })
})
