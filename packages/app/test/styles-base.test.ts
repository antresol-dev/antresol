import { stack } from '../app/lib/styles/fonts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES, ACCENTS } from '../app/lib/accent'
import { build } from '../app/lib/styles/base'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'
import { contrast, mixHex, over, parseColor } from './fixtures/color'

/** OKLCH lightness of an opaque colour. */
function oklchL({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (v: number) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
}

/*
 * S1 Base (plan 10 Task 3): the mock-up's `base` branch of build() (styles-mockup.dc.html), the default style. Values at
 * the default accent (indigo) are the mock-up's, literally; the shades picked for contrast are listed in the module's
 * header and checked here. Contrast of every pair, theme and accent: test/styles.test.ts.
 */

const ONEST = stack('Onest')
/** Plan 12: the design system's dur-fast (100 ms) and ease-standard; the mock-up's was 150 ms, colour on plain ease. */
const TR = 'background-color 100ms cubic-bezier(0.2,0,0,1), box-shadow 100ms cubic-bezier(0.2,0,0,1), color 100ms cubic-bezier(0.2,0,0,1)'

const MOCKUP: Record<Mode, Record<string, string>> = {
  light: {
    page: '#F4F5F7',
    card: '#FFFFFF',
    cardR: '16px',
    cardSh: '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)',
    primary: '#4F46E5',
    pop: '#FFFFFF',
    popR: '12px',
  },
  dark: {
    page: '#111216',
    // Plan 12 (the design system's dark layers): a step lighter than the mock-up's #1A1C21, a 6 % rim (was 5 %).
    card: '#1E2026',
    cardR: '16px',
    cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
    primary: '#B0ACF3',
    pop: '#23262C',
    popR: '12px',
  },
}

describe.each(['light', 'dark'] as const)('Base, %s, default accent: the mock-up\'s values', (mode) => {
  const t = build(mode, STYLES.base.defaultAccent)
  const m = MOCKUP[mode]

  it('page, card, its radius and shadow; the primary fill; the menu and its radius', () => {
    expect(STYLES.base.defaultAccent).toBe('indigo')
    expect([t.page, t.card, t.cardR, t.cardSh]).toEqual([m.page, m.card, m.cardR, m.cardSh])
    expect(t.kinds.primary.n.bg).toBe(m.primary)
    expect([t.pop, t.popR]).toEqual([m.pop, m.popR])
  })

  it('type, icons, motion', () => {
    expect([t.font, t.headFont, t.labelFont]).toEqual([ONEST, ONEST, ONEST])
    expect([t.headWeight, t.headTrack, t.labelWeight, t.labelCase, t.mark, t.numFont, t.numWeight, t.btnWeight]).toEqual(['700', '-0.02em', '600', 'none', '', 'inherit', '700', '700'])
    expect([t.stroke, t.cap, t.join]).toEqual(['2', 'round', 'round'])
    expect(t.tr).toBe(TR)
  })

  it('flat: no blur, no LED, the selected row inset 6 px', () => {
    expect([t.winBg, t.winBlur, t.hdrBlur, t.surfBlur, t.ctrlBlur, t.popBlur, t.led]).toEqual(['transparent', 'none', 'none', 'none', 'none', 'none', false])
    expect([t.curM, t.curR, t.curSh, t.listR, t.photoR, t.thumbR, t.chipR, t.pillR]).toEqual(['0 6px', '10px', 'none', '16px', '16px', '12px', '8px', '12px'])
    expect([t.ibR, t.btnR, t.primR, t.ghostR, t.popItemR]).toEqual(['12px', '12px', '12px', '10px', '10px'])
  })
})

describe('Base follows the chosen accent', () => {
  it.each(ACCENT_NAMES)('%s: the primary fill is the accent (pastel on dark), the selected row its tone on the card', (accent) => {
    const { light: AL, dark: AD } = ACCENTS[accent]
    expect(parseColor(build('light', accent).kinds.primary.n.bg)).toEqual(parseColor(AL))
    expect(parseColor(build('dark', accent).kinds.primary.n.bg)).toEqual(parseColor(AD))
    expect(parseColor(build('light', accent).cur)).toEqual(parseColor(mixHex('#FFFFFF', AL, 0.1)))
    expect(parseColor(build('dark', accent).cur)).toEqual(parseColor(mixHex('#1E2026', AD, 0.16)))
  })
})

describe('Base: shades picked for contrast (the mock-up\'s amount wherever its text reads at 4.5:1)', () => {
  const same = (got: string, want: string) => expect(parseColor(got)).toEqual(parseColor(want))

  it('the primary hover lifts the accent 8 % toward white; green 5 % (8 % takes white text to 4.35:1)', () => {
    same(build('light', 'indigo').kinds.primary.h.bg, mixHex('#4F46E5', '#FFFFFF', 0.08))
    same(build('light', 'green').kinds.primary.h.bg, mixHex('#15803D', '#FFFFFF', 0.05))
    same(build('dark', 'green').kinds.primary.h.bg, mixHex('#96C6A8', '#FFFFFF', 0.08))
  })

  it('dark: the tonal button presses to a 28 % tone or less, as far as accent ink on it reads (rose 22 % … green 28 %)', () => {
    same(build('light', 'rose').kinds.btn.p.bg, mixHex('#FFFFFF', '#BE123C', 0.22))
    const amounts = [['green', 0.28], ['blue', 0.27], ['teal', 0.27], ['orange', 0.27], ['indigo', 0.26], ['violet', 0.26], ['sky', 0.26], ['slate', 0.25], ['copper', 0.24], ['pink', 0.23], ['rose', 0.22]] as const
    for (const [accent, k] of amounts) {
      same(build('dark', accent).kinds.btn.p.bg, mixHex('#1E2026', ACCENTS[accent].dark, k))
    }
  })

  it('dark: flat controls on the selected row press to a 14 % layer or less, by the same rule (rose 8 % … blue 14 %)', () => {
    expect(build('light', 'rose').ghostSel.p.bg).toBe('rgba(190,18,60,0.14)')
    const amounts = [['blue', 0.14], ['green', 0.14], ['teal', 0.13], ['orange', 0.13], ['indigo', 0.12], ['violet', 0.12], ['sky', 0.12], ['slate', 0.11], ['copper', 0.1], ['pink', 0.09], ['rose', 0.08]] as const
    for (const [accent, k] of amounts) {
      expect(build('dark', accent).ghostSel.p.bg).toBe(`rgba(${Object.values(parseColor(ACCENTS[accent].dark)).slice(0, 3).join(',')},${k})`)
    }
  })

  it('dark: icon buttons press to a 20 % layer; rose 19 % (accent ink on it over a sheet)', () => {
    expect(build('light', 'rose').kinds.ib.p.bg).toBe('rgba(190,18,60,0.14)')
    for (const accent of ACCENT_NAMES) {
      const t = build('dark', accent)
      expect(contrast(t.ink, over(parseColor(t.kinds.ib.p.bg), parseColor(t.sheet))), accent).toBeGreaterThanOrEqual(4.5)
    }
    expect(build('dark', 'indigo').kinds.ib.p.bg).toMatch(/,0\.2\)$/)
    expect(build('dark', 'rose').kinds.ib.p.bg).toMatch(/,0\.19\)$/)
  })

  it.each(ACCENT_NAMES)('%s: the "⋯" on the selected row (accent ink, the markup\'s) reads at 4.5:1 hovered and open', (accent) => {
    for (const mode of ['light', 'dark'] as const) {
      const t = build(mode, accent)
      for (const s of ['h', 'p'] as const) {
        const under = over(parseColor(t.ghostSel[s].bg), parseColor(t.cur))
        expect(contrast(t.ink, under), `${mode} ${s}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})

describe('Base: app surfaces the mock-up does not draw', () => {
  it('fields: the list\'s surface with a line that reads on a sheet; generic lines: the header\'s (light), the seam\'s (dark)', () => {
    const l = build('light', 'indigo')
    const d = build('dark', 'indigo')
    expect([l.field, l.fieldLine, l.fieldSh, l.border, l.treeLine]).toEqual(['#FFFFFF', '#D0D5DD', 'none', '#E4E7EC', '#E4E7EC'])
    expect([d.field, d.fieldLine, d.fieldSh, d.border, d.treeLine]).toEqual(['#1E2026', '#3A3E47', 'none', '#2E3138', '#2E3138'])
    // The row divider stays the mock-up's.
    expect([l.dividerColor, d.dividerColor]).toEqual(['#EEF0F3', '#262930'])
  })

  it('sheets are the card (light) or the raised layer, the menus\' colour (dark); menus and tooltips the pop panel', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = build(mode, 'indigo')
      expect([t.sheet, t.sheetSh]).toEqual([mode === 'dark' ? '#23262C' : t.card, t.cardSh])
      expect([t.tip, t.tipFg, t.tipSh]).toEqual([t.popSolid, t.popFg, t.popSh])
    }
    expect(build('dark', 'indigo').pop).toBe('#23262C')
  })

  it('dark layers (plan 12): page → card about 5 % OKLCH lightness up → raised (menus, sheets) another step', () => {
    const d = build('dark', 'indigo')
    const L = (hex: string) => oklchL(parseColor(hex))
    expect(L(d.card) - L(d.pageColor)).toBeGreaterThan(0.045)
    expect(L(d.card) - L(d.pageColor)).toBeLessThan(0.07)
    expect(L(d.pop)).toBeGreaterThan(L(d.card) + 0.015)
    expect(d.listSh).toBe(d.cardSh)
  })
})

describe('base.css', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const css = () => read('../app/assets/css/styles/base.css')
  const main = () => read('../app/assets/css/main.css')

  it('is imported once by main.css', () => {
    expect(main().match(/@import "\.\/styles\/base\.css";/g)).toHaveLength(1)
  })

  it('has no rules of its own: the dark drawer\'s edge is main.css\'s for every style, and nothing else is left', () => {
    const selectors = [...css().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].map((s) => s[1]!.trim())
    expect(selectors).toEqual([])
  })
})
