import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES, ACCENTS } from '../app/lib/accent'
import { build } from '../app/lib/styles/base'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'
import { contrast, mixHex, over, parseColor } from './fixtures/color'

/*
 * S1 Base (plan 10 Task 3): the mock-up's `base` branch of build() (styles-mockup.dc.html), the default style. Values at
 * the default accent (indigo) are the mock-up's, literally; the shades picked for contrast are listed in the module's
 * header and checked here. Contrast of every pair, theme and accent: test/styles.test.ts.
 */

const ONEST = "'Onest', system-ui, sans-serif"
const TR = 'background-color 150ms cubic-bezier(0.2,0,0,1), box-shadow 150ms cubic-bezier(0.2,0,0,1), color 150ms ease'

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
    card: '#1A1C21',
    cardR: '16px',
    cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
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
    expect(parseColor(build('dark', accent).cur)).toEqual(parseColor(mixHex('#1A1C21', AD, 0.16)))
  })
})

describe('Base: shades picked for contrast (the mock-up\'s amount wherever its text reads at 4.5:1)', () => {
  const same = (got: string, want: string) => expect(parseColor(got)).toEqual(parseColor(want))

  it('the primary hover lifts the accent 8 % toward white; green 5 % (8 % takes white text to 4.35:1)', () => {
    same(build('light', 'indigo').kinds.primary.h.bg, mixHex('#4F46E5', '#FFFFFF', 0.08))
    same(build('light', 'green').kinds.primary.h.bg, mixHex('#15803D', '#FFFFFF', 0.05))
    same(build('dark', 'green').kinds.primary.h.bg, mixHex('#96C6A8', '#FFFFFF', 0.08))
  })

  it('dark: the tonal button presses to a 28 % tone; rose 25 %, pink 26 %, slate and copper 27 % (accent ink on it)', () => {
    same(build('light', 'rose').kinds.btn.p.bg, mixHex('#FFFFFF', '#BE123C', 0.22))
    for (const [accent, k] of [['indigo', 0.28], ['rose', 0.25], ['pink', 0.26], ['slate', 0.27], ['copper', 0.27]] as const) {
      same(build('dark', accent).kinds.btn.p.bg, mixHex('#1A1C21', ACCENTS[accent].dark, k))
    }
  })

  it('dark: flat controls on the selected row press to a 14 % layer; rose 11 %, pink 12 %, slate and copper 13 %', () => {
    expect(build('light', 'rose').ghostSel.p.bg).toBe('rgba(190,18,60,0.14)')
    for (const [accent, k] of [['indigo', 0.14], ['rose', 0.11], ['pink', 0.12], ['slate', 0.13], ['copper', 0.13]] as const) {
      expect(build('dark', accent).ghostSel.p.bg).toBe(`rgba(${Object.values(parseColor(ACCENTS[accent].dark)).slice(0, 3).join(',')},${k})`)
    }
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
    expect([d.field, d.fieldLine, d.fieldSh, d.border, d.treeLine]).toEqual(['#1A1C21', '#3A3E47', 'none', '#2E3138', '#2E3138'])
    // The row divider stays the mock-up's.
    expect([l.dividerColor, d.dividerColor]).toEqual(['#EEF0F3', '#262930'])
  })

  it('sheets are the card, menus and tooltips the pop panel (spec §5)', () => {
    for (const mode of ['light', 'dark'] as const) {
      const t = build(mode, 'indigo')
      expect([t.sheet, t.sheetSh]).toEqual([t.card, t.cardSh])
      expect([t.tip, t.tipFg, t.tipSh]).toEqual([t.popSolid, t.popFg, t.popSh])
    }
  })
})

describe('base.css', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  const css = () => read('../app/assets/css/styles/base.css')
  const main = () => read('../app/assets/css/main.css')

  it('is imported once by main.css', () => {
    expect(main().match(/@import "\.\/styles\/base\.css";/g)).toHaveLength(1)
  })

  it('every rule is scoped to [data-style=\'base\']', () => {
    const selectors = [...css().replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].map((s) => s[1]!.trim()).filter((s) => !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const list of selectors) for (const s of list.split(',')) expect(s.trim(), list).toMatch(/^(\.dark)?\[data-style='base'\]/)
  })
})
