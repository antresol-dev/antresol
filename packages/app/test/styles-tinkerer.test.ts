import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES, ACCENTS } from '../app/lib/accent'
import { topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode } from '../app/lib/styles/types'
import { contrast, over, parseColor } from './fixtures/color'

/*
 * S9 Tinkerer («Технарь», plan 10, Task 6): the port of the owner's mock-up (`tinkerer` branch of build()), the shades
 * chosen for contrast (spec §8; the Task 6 report lists each with its numbers) and assets/css/styles/tinkerer.css.
 */

const MODES: Mode[] = ['light', 'dark']
const { build, defaultAccent } = STYLES.tinkerer
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const ticks = (c: string) =>
  ['top left', 'top right', 'bottom left', 'bottom right']
    .map((p) => `linear-gradient(${c}, ${c}) ${p} / 12px 1.5px no-repeat, linear-gradient(${c}, ${c}) ${p} / 1.5px 12px no-repeat`)
    .join(', ')

describe('Tinkerer: the mock-up\'s values at the style\'s accent (copper)', () => {
  it('the accent by default is copper; the accent is chosen by the user', () => {
    expect(defaultAccent).toBe('copper')
    expect(STYLES.tinkerer.fixedPalette).toBe(false)
  })

  it.each([
    [
      'light',
      {
        page: 'linear-gradient(rgba(0,0,0,0.035) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(0,0,0,0.035) 1px, transparent 1px) 0 0 / 24px 24px, #E9E7E2',
        card: `${ticks('#9A4F1E')}, linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0)), #F6F5F2`,
        cardR: '3px',
        cardSh: 'inset 0 0 0 1px #CFCBC2, inset 0 1px 0 #FFFFFF',
        pop: '#F6F5F2',
        popR: '3px',
        // The mock-up's #9A4F1E, 12 % deeper: the warm white label at 4.5:1 for every accent (Task 6 report).
        primary: '#88461a',
      },
    ],
    [
      'dark',
      {
        page: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px) 0 0 / 24px 24px, #0F1113',
        card: `${ticks('#E0A273')}, linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0)), #171A1D`,
        cardR: '3px',
        cardSh: 'inset 0 0 0 1px #2A2F35, inset 0 1px 0 rgba(255,255,255,0.04)',
        pop: '#171A1D',
        popR: '3px',
        primary: '#E0A273',
      },
    ],
  ] as const)('%s: page, card, menu, the primary\'s paint', (mode, want) => {
    const t = build(mode, defaultAccent)
    expect({ page: t.page, card: t.card, cardR: t.cardR, cardSh: t.cardSh, pop: t.pop, popR: t.popR, primary: t.kinds.primary.n.bg }).toEqual(want)
  })

  it.each(MODES)('%s: IBM Plex, mono numbers, labels and chips; thin square icons; 90 ms linear response', (mode) => {
    const t = build(mode, defaultAccent)
    const plex = "'IBM Plex Sans', system-ui, sans-serif"
    const mono = "'IBM Plex Mono', ui-monospace, monospace"
    expect({ font: t.font, headFont: t.headFont, labelFont: t.labelFont, numFont: t.numFont, chipFont: t.chipFont }).toEqual({
      font: plex,
      headFont: plex,
      labelFont: mono,
      numFont: mono,
      chipFont: mono,
    })
    // The mock-up's weights: the engine reads them once it wires them.
    expect({ headWeight: t.headWeight, labelWeight: t.labelWeight, numWeight: t.numWeight, btnWeight: t.btnWeight }).toEqual({ headWeight: '600', labelWeight: '500', numWeight: '500', btnWeight: '600' })
    expect({ stroke: t.stroke, cap: t.cap, join: t.join }).toEqual({ stroke: '1.5', cap: 'square', join: 'miter' })
    expect(t.tr).toBe('background-color 90ms linear, box-shadow 90ms linear, color 90ms linear')
    // An instrument does not bounce: no control moves when pressed.
    for (const kind of Object.values(t.kinds)) expect([kind.n.tf, kind.h.tf, kind.p.tf]).toEqual(['none', 'none', 'none'])
  })

  it.each([
    ['light', '#9A4F1E', '#1F9D55', '0 0 4px rgba(31,157,85,0.6)'],
    ['dark', '#E0A273', '#3DDC84', '0 0 6px rgba(61,220,132,0.9), 0 0 2px rgba(61,220,132,1)'],
  ] as const)('%s: "// " before section labels in the accent, capitals; the status LED', (mode, accent, ledColor, ledGlow) => {
    const t = build(mode, defaultAccent)
    expect({ mark: t.mark, markColor: t.markColor, labelCase: t.labelCase, labelTrack: t.labelTrack }).toEqual({
      mark: '// ',
      markColor: accent,
      labelCase: 'uppercase',
      labelTrack: '0.12em',
    })
    expect({ led: t.led, ledColor: t.ledColor, ledGlow: t.ledGlow }).toEqual({ led: true, ledColor, ledGlow })
  })
})

describe('Tinkerer: the accent is the user\'s', () => {
  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s: corner ticks, the mark and the selected row\'s ring in it', (mode, accent) => {
    const t = build(mode, accent)
    const C = mode === 'dark' ? ACCENTS[accent].dark : ACCENTS[accent].light
    expect(t.card.startsWith(ticks(C) + ', ')).toBe(true)
    expect(t.markColor).toBe(C)
    expect(t.curSh).toMatch(new RegExp(`^inset 0 0 0 1px rgba\\(${parseInt(C.slice(1, 3), 16)},${parseInt(C.slice(3, 5), 16)},${parseInt(C.slice(5, 7), 16)},0\\.55\\)$`))
  })

  // The "⋯" in a row: the markup's accent ink (hover:text-accent-ink, open: text-accent-ink) on the flat control's
  // hover and pressed fills; in the selected row those are ghostSel's. Tinkerer's list, row and fills are plain colours.
  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s: the "⋯" in a row and in the selected row reads 4.5:1 under the pointer and open', (mode, accent) => {
    const t = build(mode, accent)
    const list = parseColor(t.list)
    const cur = over(parseColor(t.cur), list)
    const problems: string[] = []
    for (const [label, state, under] of [
      ['ghost.h', t.kinds.ghost.h, list],
      ['ghost.p', t.kinds.ghost.p, list],
      ['ghostSel.h', t.ghostSel.h, cur],
      ['ghostSel.p', t.ghostSel.p, cur],
    ] as const) {
      for (const fg of new Set([t.ink, state.fg])) {
        const c = contrast(parseColor(fg), over(parseColor(state.bg), under))
        if (c < 4.5) problems.push(`${fg} on ${label}: ${c.toFixed(2)}`)
      }
    }
    expect(problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('assets/css/styles/tinkerer.css', () => {
  const css = read('../app/assets/css/styles/tinkerer.css')
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const body = (selector: string) => new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(rules)?.[1] ?? ''

  it('main.css imports it', () => {
    expect(read('../app/assets/css/main.css')).toMatch(/@import "\.\/styles\/tinkerer\.css";/)
  })

  it('every selector is under [data-style=\'tinkerer\'] (nothing leaks into another style)', () => {
    const selectors = [...rules.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const list of selectors) for (const s of topLevel(list)) expect(s, list).toMatch(/^\[data-style='tinkerer'\]/)
  })

  it('the stock card\'s LED: absolutely positioned, the style\'s LED colour and glow; its label is not read out', () => {
    const led = body("[data-style='tinkerer'] .stock-card::after")
    expect(led).toMatch(/position:\s*absolute/)
    expect(led).toMatch(/background:\s*var\(--st-led-color\)/)
    expect(led).toMatch(/box-shadow:\s*var\(--st-led-glow\)/)
    const label = body("[data-style='tinkerer'] .stock-card::before")
    expect(label).toMatch(/position:\s*absolute/)
    expect(label).toMatch(/content:\s*'IN STOCK'\s*\/\s*''/)
    expect(label).toMatch(/font-family:\s*var\(--st-label-font\)/)
  })

  it('no decoration takes space: no margin, padding, gap or border width; nothing but the decorations is sized', () => {
    expect(rules).not.toMatch(/margin|padding|gap|border-width|border:/)
    for (const m of rules.matchAll(/([^{};]+)\{([^}]*)\}/g)) {
      if (/(?:^|[^-])(?:width|height)\s*:/.test(m[2]!)) expect(m[1]!.trim()).toMatch(/::(?:before|after)$/)
    }
  })
})
