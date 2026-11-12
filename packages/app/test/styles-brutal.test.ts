import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import mainCss from '../app/assets/css/main.css?raw'
import { ACCENT_NAMES } from '../app/lib/accent'
import { build, MEMPHIS } from '../app/lib/styles/brutal'
import { topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'
import { contrast } from './fixtures/color'

/*
 * S6 Neo-brutal / Memphis (plan 10 Task 5): the mock-up's `brutal` branch of build() (styles-mockup.dc.html), its
 * Memphis colours always from yellow (the owner, spec §4: the mock-up turned them to start at the chosen accent), a
 * fixed palette that ignores the accent, the shades changed for contrast (spec §8), and brutal.css.
 */

const MODES: Mode[] = ['light', 'dark']
const CSS_PATH = fileURLToPath(new URL('../app/assets/css/styles/brutal.css', import.meta.url))
const brutalCss = () => readFileSync(CSS_PATH, 'utf8')

/** The mock-up's build('brutal', mode, 'default'): Memphis from yellow, no accent. */
const MOCKUP = {
  light: {
    page: 'radial-gradient(rgba(17,17,17,0.14) 1.2px, transparent 1.6px) 0 0 / 22px 22px, #FFF4DC',
    card: '#FF7AB6',
    cardR: '12px',
    cardSh: 'inset 0 0 0 2px #111111, 4px 4px 0 #111111',
    primary: '#FFD23F',
    pop: '#FFFFFF',
    popR: '12px',
    popSh: 'inset 0 0 0 2px #111111, 5px 5px 0 #111111',
    list: '#FFFFFF',
    listSh: 'inset 0 0 0 2px #111111, 4px 4px 0 #111111',
    hdr: '#FFF4DC',
    hdrSh: 'inset 0 -2px 0 #111111',
    fg: '#111111',
    muted: '#3D3D3D',
    ink: '#4139bc',
  },
  dark: {
    page: 'radial-gradient(rgba(255,255,255,0.09) 1.2px, transparent 1.6px) 0 0 / 22px 22px, #16161A',
    card: '#FF7AB6',
    cardR: '12px',
    cardSh: 'inset 0 0 0 2px #F6EFDF, 4px 4px 0 #F6EFDF',
    primary: '#FFD23F',
    pop: '#222228',
    popR: '12px',
    popSh: 'inset 0 0 0 2px #F6EFDF, 5px 5px 0 #F6EFDF',
    list: '#222228',
    listSh: 'inset 0 0 0 2px #F6EFDF, 4px 4px 0 #F6EFDF',
    hdr: '#16161A',
    hdrSh: 'inset 0 -2px 0 #F6EFDF',
    fg: '#F6EFDF',
    muted: '#CFC7B6',
    ink: '#B0ACF3',
  },
} as const
const RUBIK = "'Rubik', system-ui, sans-serif"
const UNBOUNDED = "'Unbounded', 'Rubik', system-ui, sans-serif"
const TR = 'background-color 80ms ease-out, transform 80ms ease-out, box-shadow 80ms ease-out'

describe.each(MODES)('Neo-brutal equals the mock-up (board S6): %s', (mode) => {
  const t = build(mode, 'blue')
  const m = MOCKUP[mode]

  it('page, card, menu, list, header, text', () => {
    expect({
      page: t.page,
      card: t.card,
      cardR: t.cardR,
      cardSh: t.cardSh,
      primary: t.kinds.primary.n.bg,
      pop: t.pop,
      popR: t.popR,
      popSh: t.popSh,
      list: t.list,
      listSh: t.listSh,
      hdr: t.hdr,
      hdrSh: t.hdrSh,
      fg: t.fg,
      muted: t.muted,
      ink: t.ink,
    }).toEqual(m)
  })

  it('type, icons, motion: Rubik, Unbounded titles, labels and numbers, 2.5 strokes, an 80 ms sink', () => {
    expect({ font: t.font, headFont: t.headFont, labelFont: t.labelFont, numFont: t.numFont }).toEqual({
      font: RUBIK,
      headFont: UNBOUNDED,
      labelFont: UNBOUNDED,
      numFont: UNBOUNDED,
    })
    expect([t.headWeight, t.headTrack, t.headCase, t.labelWeight, t.labelCase, t.labelTrack]).toEqual(['700', '-0.01em', 'none', '700', 'uppercase', '0.04em'])
    expect([t.numWeight, t.btnWeight, t.mark]).toEqual(['700', '700', ''])
    expect([t.stroke, t.cap, t.join]).toEqual(['2.5', 'round', 'round'])
    expect(t.tr).toBe(TR)
  })

  it('controls: lift on the ink line, a pale role colour under the pointer, sink into the shadow when pressed', () => {
    const line = mode === 'dark' ? '#F6EFDF' : '#111111'
    const surf = mode === 'dark' ? '#222228' : '#FFFFFF'
    const ring = `inset 0 0 0 2px ${line}`
    expect(t.kinds.btn.n).toEqual({ bg: surf, img: 'none', sh: `${ring}, 4px 4px 0 ${line}`, fg: m.fg, tf: 'none' })
    expect(t.kinds.btn.p).toEqual({ bg: '#5B8CFF', img: 'none', sh: `${ring}, 0 0 0 ${line}`, fg: '#111111', tf: 'translate(4px, 4px)' })
    expect(t.kinds.ib.h.bg).toBe(mode === 'dark' ? '#ffdd6f' : '#ffe99f')
    expect(t.kinds.add.p).toEqual({ bg: '#FF8C42', img: 'none', sh: `${ring}, 0 0 0 ${line}`, fg: '#111111', tf: 'translate(3px, 3px)' })
    expect(t.kinds.primary.n).toEqual({ bg: '#FFD23F', img: 'none', sh: `${ring}, 4px 4px 0 ${line}`, fg: '#111111', tf: 'none' })
    expect(t.kinds.primary.h.bg).toBe('#ffe079')
    expect(t.kinds.step.p.bg).toBe('#3DDCAA')
    expect(t.kinds.ghost.p.bg).toBe('#FFD23F')
    expect(t.stepSel.h.bg).toBe('#9eeed5')
    expect(t.ghostSel.h.bg).toBe('rgba(255,255,255,0.5)')
    expect(t.pillSelBg).toBe('#FFFFFF')
    expect(t.pillSelSh).toBe('inset 0 0 0 2px #111111, 3px 3px 0 #111111')
  })
})

describe('Neo-brutal: a fixed Memphis palette (spec §4)', () => {
  it('the Memphis colours in the mock-up\'s order, always from yellow', () => {
    expect(MEMPHIS).toEqual(['#FFD23F', '#FF7AB6', '#5B8CFF', '#3DDCAA', '#FF8C42', '#B08CFF'])
    for (const mode of MODES) {
      const t = build(mode, 'pink')
      expect(t.kinds.primary.n.bg, 'primary: yellow').toBe('#FFD23F')
      expect(t.card, 'card: pink').toBe('#FF7AB6')
      expect(t.cur, 'selected row: blue').toBe('#5B8CFF')
      expect(t.photo, 'photo: violet').toBe('#B08CFF')
      expect(t.chips, 'chips from blue').toEqual(['#5B8CFF', '#3DDCAA', '#FF8C42', '#B08CFF'])
      expect(t.thumbs, 'thumbnails from mint').toEqual(['#3DDCAA', '#FF8C42', '#FF7AB6'])
    }
  })

  it('the same tokens for every accent; the accent choice is hidden', () => {
    expect(STYLES.brutal.fixedPalette).toBe(true)
    for (const mode of MODES) for (const accent of ACCENT_NAMES) expect(build(mode, accent), `${mode} ${accent}`).toEqual(build(mode, 'blue'))
  })
})

describe('Neo-brutal: shades changed for contrast (spec §8), and app surfaces the board does not show', () => {
  it('muted ink on the Memphis colours: #2E2E2E → #282828 (4.29:1 on the selected row\'s blue)', () => {
    expect(contrast('#2E2E2E', '#5B8CFF')).toBeLessThan(4.5)
    for (const mode of MODES) {
      const t = build(mode, 'blue')
      expect([t.curMuted, t.cardMuted]).toEqual(['#282828', '#282828'])
    }
  })

  it('light: the destructive red #C8102E → #B80F2A (4.07:1 on the yellow of a hovered menu item)', () => {
    expect(contrast('#C8102E', '#FFD23F')).toBeLessThan(4.5)
    const t = build('light', 'blue')
    expect([t.popDanger, t.destructive]).toEqual(['#B80F2A', '#B80F2A'])
    expect(t.popHover).toBe('#FFD23F')
  })

  it('dark: a hovered menu item is a dark yellow with light text (on the yellow neither the light red nor the light muted text can read)', () => {
    const t = build('dark', 'blue')
    expect(t.popDanger).toBe('#FF8A8A')
    expect([t.popHover, t.popHoverFg]).toEqual(['#413b2b', '#F6EFDF'])
  })

  it.each(MODES)('%s: sheets, the opaque surface, the neutral chip and row hover are the style\'s panels, not the pink card', (mode) => {
    const t = build(mode, 'blue')
    const dark = mode === 'dark'
    const line = dark ? '#F6EFDF' : '#111111'
    expect(t.sheet).toBe(t.list)
    expect(t.sheetLine).toBe(line)
    expect(t.sheetSh).toBe(`inset 0 0 0 1px ${line}, 5px 5px 0 ${line}`)
    expect(t.surface).toBe(dark ? '#222228' : '#FFFFFF')
    expect(t.chip).toBe(dark ? '#313032' : '#ece2cc')
    expect(t.rowHover).toBe(dark ? '#413b2b' : '#ffe99f')
    expect(t.fieldSh).toBe(`inset 0 0 0 1px ${line}`)
  })
})

/** How far a shadow list reaches out of its box to the right or down (outer shadows only). */
function reach(shadow: string): number {
  if (shadow === 'none') return 0
  return Math.max(
    0,
    ...topLevel(shadow)
      .filter((s) => !s.startsWith('inset'))
      .map((s) => {
        const lengths = s.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)/g, '').match(/-?[\d.]+(?=px|\s|$)/g) ?? []
        const [x = 0, y = 0, blur = 0, spread = 0] = lengths.map(Number)
        return Math.max(x, y) + blur + spread
      }),
  )
}

describe('Neo-brutal: outer shadows fit the gaps they face (plan: at most 4 px toward a 6 px gap)', () => {
  it.each(MODES)('%s', (mode) => {
    const t = build(mode, 'blue')
    // The gallery: cover, thumbnails and the add tile are 6 px apart (ItemGallery gap-1.5).
    for (const [name, sh] of [['photoSh', t.photoSh], ['thumbSh', t.thumbSh], ['add', t.kinds.add.n.sh], ['add hover', t.kinds.add.h.sh]] as const) {
      expect(reach(sh), name).toBeLessThanOrEqual(4)
    }
    // Buttons side by side are 8 px apart or more (sheet footers gap-2, the dock gap-2.5); the stepper is 10 px from "⋯".
    for (const [name, sh] of [['btn', t.kinds.btn.n.sh], ['primary', t.kinds.primary.n.sh], ['ib', t.kinds.ib.n.sh], ['pill', t.pillSh], ['pillSel', t.pillSelSh]] as const) {
      expect(reach(sh), name).toBeLessThanOrEqual(4)
    }
    // Lists and cards: 14 px to the next block (ScreenBody gap-3.5), 8 px in settings sections (gap-2).
    expect(reach(t.listSh), 'list').toBeLessThanOrEqual(4)
    expect(reach(t.cardSh), 'card').toBeLessThanOrEqual(4)
  })
})

describe('brutal.css', () => {
  it('exists and is imported by main.css at the marked spot, before any rule', () => {
    expect(existsSync(CSS_PATH)).toBe(true)
    const at = mainCss.indexOf('@import "./styles/brutal.css";')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(mainCss.indexOf('@custom-variant'))
  })

  it('every rule is under [data-style=\'brutal\']', () => {
    const code = brutalCss().replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...code.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const list of selectors) for (const s of topLevel(list)) expect(s, list).toMatch(/^\[data-style='brutal'\]/)
  })

  it('no colour of its own: every colour is a token', () => {
    const code = brutalCss().replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l))).toEqual([])
  })

  it('tags cycle the four chip colours, thumbnails the three thumbnail colours, as on the board', () => {
    const code = brutalCss()
    expect(code).toMatch(/\.tag-chip:nth-child\(4n \+ 2\)[^{]*\{[^}]*var\(--st-chips-1\)/)
    expect(code).toMatch(/\.tag-chip:nth-child\(4n \+ 3\)[^{]*\{[^}]*var\(--st-chips-2\)/)
    expect(code).toMatch(/\.tag-chip:nth-child\(4n\)[^{]*\{[^}]*var\(--st-chips-3\)/)
    expect(code).toMatch(/\.photo-thumb:nth-child\(3n \+ 2\)[^{]*\{[^}]*var\(--st-thumbs-1\)/)
    expect(code).toMatch(/\.photo-thumb:nth-child\(3n\)[^{]*\{[^}]*var\(--st-thumbs-2\)/)
  })

  it('cards other than the stock card take the Memphis colours in turn', () => {
    const code = brutalCss()
    for (const p of ['p1', 'p2', 'p3', 'p4', 'p5']) expect(code).toMatch(new RegExp(`section:nth-of-type\\(5n( \\+ \\d)?\\) > \\.raised-card:not\\(\\.stock-card\\)[^{]*\\{[^}]*var\\(--brutal-${p}\\)`))
  })

  it('on a Memphis colour (cards, the selected row, a control under the pointer or pressed) text is ink', () => {
    const code = brutalCss()
    for (const v of ['--foreground', '--muted-foreground', '--subtle-foreground', '--icon', '--accent-ink', '--destructive']) expect(code).toContain(`${v}: var(--brutal-ink`)
    for (const state of [/\.pressable:hover/, /\.pressable:active/, /\.pressable\[data-state='open'\]/]) expect(code).toMatch(state)
    expect(code).toContain('color: var(--h-fg)')
    expect(code).toContain('color: var(--p-fg)')
  })
})

describe('Neo-brutal: every Memphis colour carries ink text at 4.5:1 (cards, chips and thumbnails cycle them)', () => {
  it.each(MODES)('%s', (mode) => {
    const t = build(mode, 'blue')
    for (const c of MEMPHIS) {
      expect(contrast(t.cardFg, c), `ink on ${c}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.cardMuted, c), `muted ink on ${c}`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(t.ghostSel.h.fg, `rgba(255,255,255,0.5)`, c), `ink on a hovered control on ${c}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const c of t.chips) for (const f of t.chipFgs) expect(contrast(f, c), `${f} on chip ${c}`).toBeGreaterThanOrEqual(4.5)
    for (const c of t.thumbs) expect(contrast(t.thumbFg, c), `thumbnail ${c}`).toBeGreaterThanOrEqual(4.5)
  })
})
