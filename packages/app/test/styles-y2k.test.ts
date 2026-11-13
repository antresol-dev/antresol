import { stack } from '../app/lib/styles/fonts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ACCENT_NAMES } from '../app/lib/accent'
import { mix, topLevel } from '../app/lib/styles/color'
import { STYLES } from '../app/lib/styles/registry'
import type { Mode, StyleTokens } from '../app/lib/styles/types'
import { contrast, over, parseColor, type Rgba } from './fixtures/color'

/*
 * S7 Y2K (plan 10, Task 6): the port of the owner's mock-up (`y2k` branch of build()), the shades chosen for contrast
 * (spec §8; the Task 6 report lists each with its numbers) and assets/css/styles/y2k.css.
 */

const MODES: Mode[] = ['light', 'dark']
const { build, defaultAccent } = STYLES.y2k
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('Y2K: the mock-up\'s values at the style\'s accent (blue)', () => {
  it('the accent by default is blue; the accent is chosen by the user', () => {
    expect(defaultAccent).toBe('blue')
    expect(STYLES.y2k.fixedPalette).toBe(false)
  })

  it.each([
    [
      'light',
      {
        // The mock-up's rgba(255,255,255,0.4) grid, its alpha scaled by --y2k-grid (plan 12: y2k.css, from 1024 px).
        page: 'repeating-linear-gradient(0deg, rgb(255 255 255 / calc(0.4 * var(--y2k-grid, 1))) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgb(255 255 255 / calc(0.4 * var(--y2k-grid, 1))) 0 1px, transparent 1px 28px), linear-gradient(135deg, #BAE6FD, #E9D5FF 50%, #FDE0F0)',
        card: 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0) 35%), rgba(255,255,255,0.62)',
        cardR: '22px',
        cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.9), 0 6px 18px -6px rgba(90,80,180,0.35)',
        pop: 'rgba(255,255,255,0.72)',
        popR: '20px',
      },
    ],
    [
      'dark',
      {
        page: 'radial-gradient(rgb(255 255 255 / calc(0.55 * var(--y2k-grid, 1))) 0.8px, transparent 1.2px) 0 0 / 38px 38px, radial-gradient(70% 50% at 20% 0%, rgba(37,99,235,0.45), transparent 60%), radial-gradient(70% 50% at 90% 60%, rgba(205,48,232,0.35), transparent 60%), #0B0D26',
        card: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 35%), rgba(255,255,255,0.07)',
        cardR: '22px',
        cardSh: 'inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 24px -8px rgba(157,185,246,0.6)',
        pop: 'rgba(20,22,60,0.72)',
        popR: '20px',
      },
    ],
  ] as const)('%s: page, card, menu', (mode, want) => {
    const t = build(mode, defaultAccent)
    expect({ page: t.page, card: t.card, cardR: t.cardR, cardSh: t.cardSh, pop: t.pop, popR: t.popR }).toEqual(want)
  })

  it.each(MODES)('%s: type, icons, motion — Exo 2, the springy press', (mode) => {
    const t = build(mode, defaultAccent)
    const exo = stack('Exo 2')
    expect({ font: t.font, headFont: t.headFont, labelFont: t.labelFont, stroke: t.stroke, cap: t.cap, join: t.join, tr: t.tr }).toEqual({
      font: exo,
      headFont: exo,
      labelFont: exo,
      stroke: '2',
      cap: 'round',
      join: 'round',
      tr: 'background-color 160ms ease, box-shadow 160ms ease, color 160ms ease, transform 260ms cubic-bezier(0.34,1.56,0.64,1)',
    })
    // The mock-up's `base` weights (the y2k branch keeps them): the engine reads them once it wires them.
    expect({ numWeight: t.numWeight, btnWeight: t.btnWeight, headWeight: t.headWeight }).toEqual({ numWeight: '700', btnWeight: '700', headWeight: '700' })
    // Springy press: every raised control and the gel sink a little (main.css applies it only without reduced motion).
    expect([t.kinds.ib.p.tf, t.kinds.add.p.tf, t.kinds.btn.p.tf, t.kinds.primary.p.tf, t.kinds.step.p.tf]).toEqual(['scale(0.95)', 'scale(0.95)', 'scale(0.96)', 'scale(0.96)', 'scale(0.94)'])
  })

  it.each([
    ['light', '#2563EB'],
    ['dark', '#9DB9F6'],
  ] as const)('%s: section labels in capitals with a ✦ in the accent', (mode, markColor) => {
    const t = build(mode, defaultAccent)
    expect({ mark: t.mark, markColor: t.markColor, labelCase: t.labelCase, labelTrack: t.labelTrack }).toEqual({
      mark: '✦ ',
      markColor,
      labelCase: 'uppercase',
      labelTrack: '0.12em',
    })
  })

  it.each(MODES)('%s: the aqua gel is the mock-up\'s #2563EB twelve per cent deeper (contrast, Task 6 report)', (mode) => {
    expect(build(mode, defaultAccent).kinds.primary.n.bg).toBe('#2157cf')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The aqua gel carries a white label. Its shine must end above the label, which lies on the paint and the glow.

interface Stop {
  color: Rgba
  at: number
}
/** The stops of a vertical linear-gradient (positions in %; a stop without one is at 0 % first, 100 % last). */
function gradientStops(layer: string): Stop[] {
  const body = /^linear-gradient\(180deg,\s*(.*)\)$/.exec(layer)?.[1]
  if (!body) throw new Error(`not a vertical gradient: ${layer}`)
  const parts = topLevel(body)
  return parts.map((part, i) => {
    const m = /^(rgba?\([^()]*\)|#[0-9a-fA-F]{3,8}|transparent)(?:\s+([\d.]+)%)?$/.exec(part)
    if (!m) throw new Error(`unexpected stop: ${part}`)
    return { color: parseColor(m[1]!), at: m[2] === undefined ? (i === 0 ? 0 : 100) : Number(m[2]) }
  })
}
/** A gradient's colour at y % (stops of one colour: its alpha interpolates). */
function at(stops: Stop[], y: number): Rgba {
  const first = stops[0]!
  const last = stops.at(-1)!
  if (y <= first.at) return first.color
  if (y >= last.at) return last.color
  const i = stops.findIndex((s) => s.at >= y)
  const [a, b] = [stops[i - 1]!, stops[i]!]
  const k = b.at === a.at ? 1 : (y - a.at) / (b.at - a.at)
  return { r: a.color.r + (b.color.r - a.color.r) * k, g: a.color.g + (b.color.g - a.color.g) * k, b: a.color.b + (b.color.b - a.color.b) * k, a: a.color.a + (b.color.a - a.color.a) * k }
}

describe('Y2K: the aqua gel\'s label', () => {
  // 14 px labels in 36–44 px buttons and the dock's 24 px plus in 52 px: from 36 % to 64 % of the height, and a margin.
  const band = Array.from({ length: 33 }, (_, i) => 34 + i)

  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))(
    '%s, %s: white at 4.5:1 or better wherever the label lies, at rest, under the pointer and pressed',
    (mode, accent) => {
      const t = build(mode, accent)
      const problems: string[] = []
      for (const s of ['n', 'h', 'p'] as const) {
        const state = t.kinds.primary[s]
        const layers = topLevel(state.img).map(gradientStops)
        const paint = parseColor(state.bg)
        for (const y of band) {
          const backdrop = layers.reduceRight((under, layer) => over(at(layer, y), under), paint)
          const c = contrast(parseColor(state.fg), backdrop)
          if (c < 4.5) problems.push(`${s} at ${y} %: ${c.toFixed(2)}`)
        }
      }
      expect(problems).toEqual([])
    },
  )

  it('the shine is a layer of its own over the top third; the glow rises from the middle', () => {
    const [shine, glow] = topLevel(build('light', defaultAccent).kinds.primary.n.img).map(gradientStops)
    expect(at(shine!, 33).a).toBe(0)
    expect(at(glow!, 50).a).toBe(0)
    expect(at(shine!, 0).a).toBe(0.75)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// The "⋯" in a row: its text is the markup's accent ink (hover:text-accent-ink, data-[state=open]:text-accent-ink) on
// the flat control's hover and pressed fills; in a selected row those are ghostSel's.

const decoration = (layer: string) => /\/\s*[\d.]+(px|%)/.test(layer) || /no-repeat/.test(layer)
const plain = (s: string): Rgba | null => {
  try {
    return parseColor(s)
  } catch {
    return null
  }
}
/** The colours a background shows behind text (as test/styles.test.ts reads them): its bottom layer's colour or
 *  gradient stops, the plain colours above drawn over; drawn over each of `under`. */
function backdrops(background: string, under: Rgba[]): Rgba[] {
  const layers = topLevel(background).filter((l) => !decoration(l))
  const bottom = layers.at(-1) ?? 'transparent'
  const p = plain(bottom)
  const base = p ? [p] : [...bottom.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\btransparent\b/g)].map((m) => parseColor(m[0]))
  let out = base.flatMap((c) => under.map((u) => over(c, u)))
  for (const layer of layers.slice(0, -1).reverse()) {
    const c = plain(layer)
    if (c) out = out.map((u) => over(c, u))
  }
  return out
}
function rowMenuProblems(t: StyleTokens): string[] {
  const page = backdrops(t.page, [{ r: 255, g: 255, b: 255, a: 1 }])
  const list = backdrops(t.list, page)
  const cur = backdrops(t.cur, list)
  const problems: string[] = []
  const cases = [
    ['ghost.h on list', t.kinds.ghost.h, list],
    ['ghost.p on list', t.kinds.ghost.p, list],
    ['ghostSel.h on cur', t.ghostSel.h, cur],
    ['ghostSel.p on cur', t.ghostSel.p, cur],
  ] as const
  for (const [label, state, under] of cases) {
    for (const b of backdrops(state.bg, under)) {
      // The markup's accent ink, and the token's own text colour.
      for (const fg of new Set([t.ink, state.fg])) {
        const c = contrast(parseColor(fg), b)
        if (c < 4.5) problems.push(`${fg} ${label}: ${c.toFixed(2)}`)
      }
    }
  }
  return problems
}

describe('Y2K: the "⋯" in a row and in the selected row', () => {
  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s: accent ink at 4.5:1 under the pointer and with its menu open', (mode, accent) => {
    expect(rowMenuProblems(build(mode, accent))).toEqual([])
  })

  it('on a selected row: a frosted white bubble on light, a navy well on dark (not a second accent tint)', () => {
    expect([build('light', 'blue').ghostSel.h.bg, build('light', 'blue').ghostSel.p.bg]).toEqual(['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.7)'])
    expect([build('dark', 'blue').ghostSel.h.bg, build('dark', 'blue').ghostSel.p.bg]).toEqual(['rgba(11,13,38,0.15)', 'rgba(11,13,38,0.25)'])
  })

  it('dark: the chrome under the pointer is tinted with the deep accent and keeps the light label', () => {
    const t = build('dark', 'blue')
    expect(t.kinds.btn.h.img).toBe(`linear-gradient(180deg, ${mix('#2563EB', '#5A6380', 0.5)} 0%, #2C3248 50%, #1F2436 51%, ${mix('#2563EB', '#3A4260', 0.6)} 100%)`)
    expect([t.kinds.ib.h.fg, t.kinds.add.h.fg, t.kinds.btn.h.fg, t.kinds.step.h.fg, t.kinds.step.p.fg]).toEqual(Array(5).fill(t.fg))
  })
})

describe('Y2K: sheets and dialogs lie over the scrim, not the wallpaper', () => {
  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s: text, muted text, accent ink and danger at 4.5:1 on the sheet over the scrim', (mode, accent) => {
    const t = build(mode, accent)
    const scrimmed = backdrops(t.overlay, backdrops(t.page, [{ r: 255, g: 255, b: 255, a: 1 }]))
    const problems: string[] = []
    for (const b of backdrops(t.sheet, scrimmed)) {
      for (const [label, fg] of [['fg', t.fg], ['muted', t.muted], ['subtle', t.subtle], ['ink', t.ink], ['destructive', t.destructive]] as const) {
        const c = contrast(parseColor(fg), b)
        if (c < 4.5) problems.push(`${label} ${fg}: ${c.toFixed(2)}`)
      }
    }
    expect(problems).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('assets/css/styles/y2k.css', () => {
  const css = read('../app/assets/css/styles/y2k.css')
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')

  it('main.css imports it', () => {
    expect(read('../app/assets/css/main.css')).toMatch(/@import "\.\/styles\/y2k\.css";/)
  })

  it('every selector is under [data-style=\'y2k\'] (nothing leaks into another style)', () => {
    const selectors = [...rules.matchAll(/([^{};]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => !s.startsWith('@'))
    expect(selectors.length).toBeGreaterThan(0)
    for (const list of selectors) for (const s of topLevel(list)) expect(s, list).toMatch(/^\[data-style='y2k'\]/)
  })

  it('tag chips cycle through the four pastels and thumbnails through the three', () => {
    const t = build('light', defaultAccent)
    expect(t.chips).toHaveLength(4)
    expect(t.thumbs).toHaveLength(3)
    for (const v of ['--st-chips-1', '--st-chips-2', '--st-chips-3', '--st-thumbs-1', '--st-thumbs-2']) expect(rules).toContain(`var(${v})`)
  })
})

describe('Y2K: plan 12', () => {
  const css = read('../app/assets/css/styles/y2k.css').replace(/\/\*[\s\S]*?\*\//g, '')

  it('the wallpaper\'s grid and stars are 30 % fainter from 1024 px: y2k.css scales their alpha on the root, nothing else', () => {
    expect(css).toMatch(/@media \(width >= 64rem\)\s*\{\s*\[data-style='y2k'\]:root\s*\{\s*--y2k-grid: 0\.7;\s*\}\s*\}/)
    for (const mode of MODES) {
      const page = build(mode, defaultAccent).page
      expect(page.match(/var\(--y2k-grid, 1\)/g)?.length, mode).toBe(mode === 'light' ? 2 : 1)
    }
  })

  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s: six row thumbnail tones round the accent\'s hue, the body text on them', (mode, accent) => {
    const t = build(mode, accent)
    expect(new Set(t.thumbTones.map((x) => x.bg)).size).toBe(6)
    expect(t.thumbTones[0]!.bg).toBe(t.thumbs[0])
    for (const x of t.thumbTones) expect(x.fg).toBe(t.fg)
  })
})
