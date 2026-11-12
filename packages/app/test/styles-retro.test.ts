import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import mainCss from '../app/assets/css/main.css?raw'
import { ACCENT_NAMES } from '../app/lib/accent'
import { topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import { build } from '../app/lib/styles/retro'
import type { Mode } from '../app/lib/styles/types'
import { contrast } from './fixtures/color'

/*
 * S8 Retro atomic (plan 10 Task 5): the mock-up's `retro` branch of build() (styles-mockup.dc.html) with its accent
 * always teal (spec §4), a fixed palette that ignores the accent, the shades changed for contrast (spec §8), and
 * retro.css (dashed dividers, the sheet's boomerang corners).
 */

const MODES: Mode[] = ['light', 'dark']
const CSS_PATH = fileURLToPath(new URL('../app/assets/css/styles/retro.css', import.meta.url))
const retroCss = () => readFileSync(CSS_PATH, 'utf8')

const BOOM = '26px 8px 26px 8px'
/** The mock-up's build('retro', mode, 'default'): the accent is teal. */
const MOCKUP = {
  light: {
    page: 'radial-gradient(circle at 20px 20px, rgba(42,157,143,0.20) 3px, transparent 3.5px) 0 0 / 80px 80px, radial-gradient(circle at 60px 52px, rgba(231,111,81,0.18) 2px, transparent 2.5px) 0 0 / 80px 80px, #F3E9D2',
    card: '#FBF5E6',
    cardR: BOOM,
    cardSh: 'inset 0 0 0 1.5px rgba(43,42,51,0.85), 4px 4px 0 #E9C46A',
    primary: '#0F766E',
    pop: '#FBF5E6',
    popR: '18px 6px 18px 6px',
    popSh: 'inset 0 0 0 1.5px rgba(43,42,51,0.85), 5px 5px 0 #2A9D8F',
    list: '#FBF5E6',
    listR: '22px 8px 22px 8px',
    divider: '1px dashed rgba(43,42,51,0.25)',
    seam: '1px dashed rgba(43,42,51,0.85)',
    cur: '#ccdcce',
    curR: '16px 6px 16px 6px',
    hdr: '#F3E9D2',
    hdrSh: 'inset 0 -1.5px 0 rgba(43,42,51,0.85)',
    fg: '#2B2A33',
    muted: '#625B4E',
    ink: '#0c615a',
  },
  dark: {
    page: 'radial-gradient(circle at 20px 20px, rgba(244,236,216,0.32) 2px, transparent 2.5px) 0 0 / 80px 80px, radial-gradient(circle at 60px 52px, rgba(42,157,143,0.5) 2px, transparent 2.5px) 0 0 / 80px 80px, #1C2335',
    card: '#273049',
    cardR: BOOM,
    cardSh: 'inset 0 0 0 1.5px rgba(244,236,216,0.7), 4px 4px 0 rgba(233,196,106,0.55)',
    primary: '#93C1BE',
    pop: '#273049',
    popR: '18px 6px 18px 6px',
    popSh: 'inset 0 0 0 1.5px rgba(244,236,216,0.7), 5px 5px 0 #2A9D8F',
    list: '#273049',
    listR: '22px 8px 22px 8px',
    divider: '1px dashed rgba(244,236,216,0.25)',
    seam: '1px dashed rgba(244,236,216,0.7)',
    cur: '#475c6c',
    curR: '16px 6px 16px 6px',
    hdr: '#1C2335',
    hdrSh: 'inset 0 -1.5px 0 rgba(244,236,216,0.7)',
    fg: '#F4ECD8',
    muted: '#C9C1AE',
    ink: '#93C1BE',
  },
} as const
const JOST = "'Jost', system-ui, sans-serif"
const TR = 'background-color 200ms ease-in-out, color 200ms ease-in-out, transform 140ms ease-out, box-shadow 140ms ease-out'

describe.each(MODES)('Retro atomic equals the mock-up (board S8): %s', (mode) => {
  const t = build(mode, 'rose')
  const m = MOCKUP[mode]

  it('page, card, menu, list, selected row, header, text', () => {
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
      listR: t.listR,
      divider: t.divider,
      seam: t.seam,
      cur: t.cur,
      curR: t.curR,
      hdr: t.hdr,
      hdrSh: t.hdrSh,
      fg: t.fg,
      muted: t.muted,
      ink: t.ink,
    }).toEqual(m)
  })

  it('type, icons, motion: Jost in capitals, the ✦ mark in orange, round strokes, a smooth 200 ms', () => {
    expect([t.font, t.headFont, t.labelFont]).toEqual([JOST, JOST, JOST])
    expect([t.headWeight, t.headTrack, t.headCase]).toEqual(['600', '0.06em', 'uppercase'])
    expect([t.labelWeight, t.labelCase, t.labelTrack]).toEqual(['600', 'uppercase', '0.16em'])
    expect([t.mark, t.markColor]).toEqual(['✦ ', '#E76F51'])
    expect([t.numWeight, t.btnWeight, t.numFont]).toEqual(['600', '600', 'inherit'])
    expect([t.stroke, t.cap, t.join]).toEqual(['2', 'round', 'round'])
    expect(t.tr).toBe(TR)
  })

  it('boomerang corners, print offsets, round controls', () => {
    expect([t.photoR, t.thumbR, t.chipR, t.pillR, t.ibR, t.btnR, t.primR, t.ghostR, t.popItemR]).toEqual([BOOM, '999px', '999px', '999px', '999px', '999px', '999px', '999px', '999px'])
    const line = mode === 'dark' ? 'rgba(244,236,216,0.7)' : 'rgba(43,42,51,0.85)'
    const off = mode === 'dark' ? 'rgba(233,196,106,0.55)' : '#E9C46A'
    expect(t.kinds.btn.n.sh).toBe(`inset 0 0 0 1.5px ${line}, 3px 3px 0 ${off}`)
    expect(t.kinds.btn.p.tf).toBe('translate(3px, 3px)')
    expect(t.kinds.primary.n.sh).toBe(`inset 0 0 0 1.5px ${line}, 3px 3px 0 #E76F51`)
    expect(t.photo).toBe('#1F7A70')
    expect(t.chips).toEqual(['#E9C46A', '#9FD3C7', '#F4A58A'])
    expect(t.thumbs).toEqual(['#E9C46A', '#E76F51', '#2A9D8F'])
  })
})

describe('Retro atomic: a fixed palette, the accent always teal (spec §4)', () => {
  it('the same tokens for every accent; the accent choice is hidden', () => {
    expect(STYLES.retro.fixedPalette).toBe(true)
    expect(STYLES.retro.defaultAccent).toBe('teal')
    for (const mode of MODES) for (const accent of ACCENT_NAMES) expect(build(mode, accent), `${mode} ${accent}`).toEqual(build(mode, 'teal'))
  })
})

describe('Retro atomic: shades changed for contrast (spec §8), and app surfaces the board does not show', () => {
  it('thumbnail ink #2B2A33 → #24232B (4.26:1 on the teal thumbnail)', () => {
    expect(contrast('#2B2A33', '#2A9D8F')).toBeLessThan(4.5)
    for (const mode of MODES) expect(build(mode, 'teal').thumbFg).toBe('#24232B')
  })

  it('light: the primary\'s hover lightens 12 % toward white in the mock-up, under 4.5:1 with its cream text; it darkens instead', () => {
    expect(contrast('#FBF5E6', '#2c867f')).toBeLessThan(4.5)
    const t = build('light', 'teal')
    expect(t.kinds.primary.h.bg).toBe('#0e6d65')
  })

  it('dark: muted text on the selected row #C9C1AE → #dad2bf (3.89:1 on its teal)', () => {
    expect(contrast('#C9C1AE', '#475c6c')).toBeLessThan(4.5)
    const t = build('dark', 'teal')
    expect(t.cur).toBe('#475c6c')
    expect([t.curMuted, t.ghostSel.n.fg]).toEqual(['#dad2bf', '#dad2bf'])
  })

  it('dark: a hovered menu item is teal 18 % instead of 25 % (#425466 → #3a4a5e; the danger red was 3.94:1 on it)', () => {
    expect(contrast('#F4A58A', '#425466')).toBeLessThan(4.5)
    const t = build('dark', 'teal')
    expect([t.popHover, t.popDanger]).toEqual(['#3a4a5e', '#F4A58A'])
  })

  it.each(MODES)('%s: the neutral chip is a shade of the page (the mustard tag colour does not carry muted text)', (mode) => {
    const t = build(mode, 'teal')
    expect(t.chip).toBe(mode === 'dark' ? '#363b49' : '#e3dac5')
  })
})

describe('retro.css', () => {
  it('exists and is imported by main.css at the marked spot, before any rule', () => {
    expect(existsSync(CSS_PATH)).toBe(true)
    const at = mainCss.indexOf('@import "./styles/retro.css";')
    expect(at).toBeGreaterThan(0)
    expect(at).toBeLessThan(mainCss.indexOf('@custom-variant'))
  })

  it('every rule is under [data-style=\'retro\']', () => {
    const code = retroCss().replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = [...code.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const list of selectors) for (const s of topLevel(list)) expect(s, list).toMatch(/^\[data-style='retro'\]/)
  })

  it('no colour of its own: every colour is a token', () => {
    const code = retroCss().replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code.split('\n').filter((l) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l))).toEqual([])
  })

  it('row dividers are the divider token, dashed', () => {
    const code = retroCss()
    expect(code).toMatch(/\[class\*='before:bg-divider'\]::before[^{]*\{[^}]*border-top: var\(--st-divider\)/)
    expect(code).toMatch(/\.divide-divider[^{]*\{[^}]*border-style: dashed/)
  })

  it('tags and thumbnails cycle their colours, as on the board', () => {
    const code = retroCss()
    expect(code).toMatch(/\.tag-chip:nth-child\(3n \+ 2\)[^{]*\{[^}]*var\(--st-chips-1\)/)
    expect(code).toMatch(/\.tag-chip:nth-child\(3n\)[^{]*\{[^}]*var\(--st-chips-2\)/)
    expect(code).toMatch(/\.photo-thumb:nth-child\(3n \+ 2\)[^{]*\{[^}]*var\(--st-thumbs-1\)/)
    expect(code).toMatch(/\.photo-thumb:nth-child\(3n\)[^{]*\{[^}]*var\(--st-thumbs-2\)/)
  })

  it('the phone sheet keeps the boomerang on its top corners (a 4-value radius is not valid per corner)', () => {
    expect(retroCss()).toMatch(/\.surface-sheet\.rounded-t-card[^{]*\{[^}]*border-top-left-radius:[^}]*border-top-right-radius:/)
  })

  it('an open row menu\'s "⋯" shows the pressed text colour (accent-ink on the dark pressed tint is 3.94:1)', () => {
    const t = build('dark', 'teal')
    expect(contrast(t.ink, t.kinds.ghost.p.bg)).toBeLessThan(4.5)
    expect(contrast(t.kinds.ghost.p.fg, t.kinds.ghost.p.bg)).toBeGreaterThanOrEqual(4.5)
    expect(retroCss()).toMatch(/\.pressable\[data-state='open'\][^{]*\{[^}]*--accent-ink: var\(--p-fg\)/)
  })
})

describe('Retro atomic: every cycled colour carries its text at 4.5:1', () => {
  it.each(MODES)('%s', (mode) => {
    const t = build(mode, 'teal')
    for (const c of t.chips) for (const f of t.chipFgs) expect(contrast(f, c), `${f} on chip ${c}`).toBeGreaterThanOrEqual(4.5)
    for (const c of t.thumbs) expect(contrast(t.thumbFg, c), `thumbnail ${c}`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t.photoFg, t.photo), 'photo').toBeGreaterThanOrEqual(4.5)
  })
})
