import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import css from '../app/assets/css/main.css?raw'
import { ACCENT_NAMES, ACCENTS, type AccentName } from '../app/lib/accent'
import { createAppearance } from '../app/lib/appearance'
import { createMemoryDeviceDb, type DeviceSettings } from '../app/lib/device-db'
import { applyStyle, STYLE_ELEMENT_ID, styleCss, styleVars } from '../app/lib/styles/apply'
import { topLevel } from '../app/lib/styles/color'
import { deriveSurfaces, mirrorY } from '../app/lib/styles/derive'
import { build as neumorphism } from '../app/lib/styles/neumorphism'
import { DEFAULT_STYLE, effectiveAccent, isStyleName, STYLE_NAMES, STYLES } from '../app/lib/styles/registry'
import type { Kind, KindName, Mode, StyleName, StyleTokens } from '../app/lib/styles/types'
import { fakeRoot } from './fixtures/fake-dom'
import { contrast, cssVars, evaluate, mixHex, over, parseColor, substitute, type Rgba, type Vars } from './fixtures/color'

/*
 * The style engine (spec 2026-11-12 styles §3, §4, §6, §8; plan 10 Task 1): the registry, Neumorphism equal to the app
 * as it was, applying a style (Review Focus 1), contrast of every style × theme × accent, no layout in tokens (Review
 * Focus 3), the appearance setting (Review Focus 4) and main.css reading only the style's variables.
 */

// The plugin's own imports (Nuxt's ~ alias): the real appearance, a device store that tests fill.
const pluginDb = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('~/lib/appearance', () => import('../app/lib/appearance'))
vi.mock('~/lib/device-db', () => ({ openDeviceDb: async () => pluginDb.current }))

const MODES: Mode[] = ['light', 'dark']
const KINDS: KindName[] = ['ib', 'add', 'btn', 'primary', 'step', 'ghost']

describe('registry (plan 10, Task 1)', () => {
  it('nine styles in the order of the boards S1–S9; Base by default (the owner)', () => {
    expect(STYLE_NAMES).toEqual(['base', 'neumorphism', 'acrylic', 'liquid', 'linear', 'brutal', 'y2k', 'retro', 'tinkerer'])
    expect(Object.keys(STYLES).sort()).toEqual([...STYLE_NAMES].sort())
    expect(DEFAULT_STYLE).toBe('base')
  })
  it.each([
    ['base', 'Base', false, 'indigo', ['Onest']],
    ['neumorphism', 'Neumorphism', false, 'indigo', ['Manrope']],
    ['acrylic', 'Acrylic', false, 'blue', ['Inter']],
    ['liquid', 'Liquid glass', false, 'blue', ['Inter']],
    ['linear', 'Linear', false, 'indigo', ['Inter']],
    ['brutal', 'Neo-brutal', true, 'blue', ['Rubik', 'Unbounded']],
    ['y2k', 'Y2K', false, 'blue', ['Exo 2']],
    ['retro', 'Retro atomic', true, 'teal', ['Jost']],
    ['tinkerer', 'Tinkerer', false, 'copper', ['IBM Plex Sans', 'IBM Plex Mono']],
  ] as const)('%s: %s, fixed palette %s, accent %s, fonts %j', (name, label, fixedPalette, defaultAccent, fonts) => {
    const info = STYLES[name]
    expect(info.name).toBe(name)
    expect({ label: info.label, fixedPalette: info.fixedPalette, defaultAccent: info.defaultAccent, fonts: info.fonts }).toEqual({
      label,
      fixedPalette,
      defaultAccent,
      fonts,
    })
  })
  it('isStyleName knows the nine only', () => {
    expect(STYLE_NAMES.every(isStyleName)).toBe(true)
    for (const v of ['toString', 'Base', 'material', '', undefined, 3]) expect(isStyleName(v)).toBe(false)
  })
  it('the effective accent: a fixed palette\'s own; otherwise the chosen one or the style\'s default', () => {
    expect(effectiveAccent('base', 'rose')).toBe('rose')
    expect(effectiveAccent('base', null)).toBe('indigo')
    expect(effectiveAccent('tinkerer', null)).toBe('copper')
    expect(effectiveAccent('retro', 'rose')).toBe('teal')
    expect(effectiveAccent('brutal', null)).toBe('blue')
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Neumorphism = main.css as it was before styles (Plan 10's base). The oracle is that file, frozen in fixtures.

const oldCss = readFileSync(fileURLToPath(new URL('./fixtures/main-before-styles.css', import.meta.url)), 'utf8')
const old = {
  root: cssVars(oldCss, ':root'),
  dark: cssVars(oldCss, '.dark'),
  theme: cssVars(oldCss, '@theme'),
  painted: cssVars(oldCss, '.painted'),
  paintedDark: cssVars(oldCss, '.dark .painted'),
  paintedDestructive: cssVars(oldCss, '.painted-destructive'),
  paintedDestructiveDark: cssVars(oldCss, '.dark .painted-destructive'),
}
const flat = (s: string) => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
/** The block of the first rule with exactly this selector. */
const ruleBody = (source: string, selector: string) =>
  new RegExp(`(?:^|[{};/])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''

/** <html> as lib/accent.ts wrote it before styles: the light accent and the light one lifted by 12 % white. */
function before(mode: Mode, accent: AccentName): Vars {
  const AL = ACCENTS[accent].light
  return { ...old.root, ...(mode === 'dark' ? old.dark : {}), 'accent-light': AL, 'accent-dark': mixHex(AL, '#FFFFFF', 0.12) }
}
const resolve = (vars: Vars, name: string): Rgba => evaluate(substitute(`var(--${name})`, vars))

interface Shadow {
  inset: boolean
  lengths: number[]
  color: Rgba
}
/** Words of a shadow, split on spaces outside parentheses. */
function words(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s.trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
function shadows(list: string, vars: Vars = {}): Shadow[] {
  const s = substitute(list, vars)
  if (s.trim() === 'none') return []
  return topLevel(s).map((part) => {
    const w = words(part)
    const length = (x: string) => /^-?[\d.]+(px)?$/.test(x)
    const color = w.find((x) => x !== 'inset' && !length(x))
    return { inset: w.includes('inset'), lengths: w.filter(length).map(parseFloat), color: color ? evaluate(color) : { r: 0, g: 0, b: 0, a: 0 } }
  })
}

/** Colours equal as drawn: color-mix keeps fractions where the mock-up's mix() rounds to whole channels. */
function colourProblem(got: Rgba, want: Rgba): string | null {
  if (want.a === 0 && got.a === 0) return null
  for (const ch of ['r', 'g', 'b'] as const) if (Math.abs(got[ch] - want[ch]) > 0.5) return `${ch} ${got[ch]} ≠ ${want[ch]}`
  return Math.abs(got.a - want.a) > 0.0011 ? `alpha ${got.a} ≠ ${want.a}` : null
}
function shadowProblem(got: Shadow[], want: Shadow[]): string | null {
  // Zero, transparent shadows are padding (they keep raised and pressed lists the same shape); Tailwind's shadow
  // utilities add some of their own.
  const strip = (l: Shadow[]) => l.filter((s) => !(s.color.a === 0 && s.lengths.every((x) => x === 0)))
  if (got.length !== want.length) return `${got.length} shadows ≠ ${want.length}`
  for (let i = 0; i < got.length; i++) {
    const g = got[i]!
    const w = want[i]!
    if (g.inset !== w.inset || g.lengths.join(' ') !== w.lengths.join(' ')) return `shadow ${i}: ${g.inset} ${g.lengths} ≠ ${w.inset} ${w.lengths}`
    const c = colourProblem(g.color, w.color)
    if (c && !(strip([g]).length === 0 && strip([w]).length === 0)) return `shadow ${i}: ${c}`
  }
  return null
}

const k = (t: StyleTokens, kind: KindName | 'stepSel' | 'ghostSel' | 'painted' | 'paintedDanger'): Kind =>
  kind === 'stepSel' || kind === 'ghostSel' || kind === 'painted' || kind === 'paintedDanger' ? t[kind] : t.kinds[kind]

describe.each(MODES)('Neumorphism equals main.css before styles: %s', (mode) => {
  describe.each(ACCENT_NAMES)('accent %s', (accent) => {
    const t = neumorphism(mode, accent)
    const v = before(mode, accent)
    const paintedVars = (destructive: boolean): Vars => ({
      ...v,
      ...old.painted,
      ...(mode === 'dark' ? old.paintedDark : {}),
      ...(destructive ? old.paintedDestructive : {}),
      ...(destructive && mode === 'dark' ? old.paintedDestructiveDark : {}),
    })
    const pv = { accent: paintedVars(false), destructive: paintedVars(true) }

    it('colours', () => {
      const pairs: [string, string, Vars?][] = [
        ['background', t.pageColor], ['background', t.page], ['surface', t.surface], ['surface', t.card], ['surface', t.sheet],
        ['surface', t.pillBg], ['surface', t.kinds.btn.n.bg], ['surface', t.kinds.ib.n.bg], ['surface', t.kinds.add.n.bg],
        ['popover', t.popSolid], ['foreground', t.fg], ['foreground', t.cardFg], ['foreground', t.popFg], ['foreground', t.chipFgs[0]!],
        ['foreground', t.tip], ['background', t.tipFg], ['muted-foreground', t.muted], ['muted-foreground', t.cardMuted],
        ['muted-foreground', t.photoFg], ['muted-foreground', t.kinds.ghost.n.fg], ['subtle-foreground', t.subtle],
        ['dimmed-foreground', t.dimmed], ['selected-muted', t.curMuted], ['thumb-foreground', t.thumbFg], ['icon', t.icon],
        ['icon', t.kinds.ib.n.fg], ['icon', t.kinds.step.n.fg], ['destructive', t.destructive], ['destructive-foreground', t.destructiveFg],
        ['warning', t.warning], ['divider', t.dividerColor], ['border', t.border], ['border', t.hdrLine], ['border', t.sheetLine],
        ['input', t.fieldLine], ['tree-line', t.treeLine], ['accent', t.accent], ['accent-paint', t.painted.n.bg],
        ['accent-foreground', t.painted.n.fg], ['accent-ink', t.ink], ['accent-ink', t.curFg], ['accent-ink', t.accentSoftFg],
        ['accent-ink', t.kinds.btn.h.fg], ['accent-ink', t.kinds.ib.h.fg], ['accent-ink', t.kinds.step.h.fg], ['accent-ink', t.kinds.ghost.h.fg],
        ['accent-ink', t.kinds.ghost.p.fg], ['accent-soft', t.accentSoft], ['hover', t.rowHover], ['hover', t.kinds.btn.h.bg],
        ['hover', t.kinds.ib.h.bg], ['hover', t.kinds.add.h.bg], ['pressed', t.kinds.btn.p.bg], ['pressed', t.kinds.ib.p.bg],
        ['pressed', t.kinds.step.p.bg], ['ghost-hover', t.kinds.ghost.h.bg], ['ghost-hover', t.kinds.step.h.bg],
        ['ghost-pressed', t.kinds.ghost.p.bg], ['selected-pill', t.pillSelBg], ['selected-step-hover', t.stepSel.h.bg],
        ['selected-step-hover-ink', t.stepSel.h.fg], ['selected-step-pressed', t.stepSel.p.bg], ['chip', t.chip], ['chip', t.chips[0]!],
        ['thumb', t.thumb], ['thumb', t.thumbs[0]!], ['thumb', t.photo], ['field', t.field], ['rail', t.rail],
        ['glass-hover', t.popHover], ['glass-hover-foreground', t.popHoverFg],
        ['glass-divider', t.popDiv], ['glass-muted', t.popMuted], ['glass-danger', t.popDanger], ['glass-border', t.popBorder],
        ['glass-bg', topLevel(t.pop).at(-1)!], ['primary', t.primary], ['primary-foreground', t.primaryFg], ['ring', t.ring],
        ['popover-foreground', t.popFg], ['pill-seam', t.seam.replace(/^1px solid /, '')], ['divider', t.divider.replace(/^1px solid /, '')],
        ['paint', t.painted.n.bg, pv.accent], ['paint-hover', t.painted.h.bg, pv.accent], ['paint-pressed', t.painted.p.bg, pv.accent],
        ['paint-foreground', t.painted.h.fg, pv.accent], ['paint', t.paintedDanger.n.bg, pv.destructive],
        ['paint-hover', t.paintedDanger.h.bg, pv.destructive], ['paint-pressed', t.paintedDanger.p.bg, pv.destructive],
        ['paint-foreground', t.paintedDanger.n.fg, pv.destructive], ['paint-foreground', t.paintedDanger.p.fg, pv.destructive],
      ]
      const problems = pairs.flatMap(([name, value, vars]) => {
        const p = colourProblem(evaluate(value), resolve(vars ?? v, name))
        return p ? [`--${name} vs ${value}: ${p}`] : []
      })
      // The selected row: the accent's gradient from --selected-from to --selected-to.
      expect(t.cur).toMatch(/^linear-gradient\(90deg, /)
      const [from, to] = [...t.cur.matchAll(/rgba\([^)]*\)/g)].map((m) => evaluate(m[0]))
      for (const [name, got] of [['selected-from', from!], ['selected-to', to!]] as const) {
        const p = colourProblem(got, resolve(v, name))
        if (p) problems.push(`--${name}: ${p}`)
      }
      expect(problems).toEqual([])
    })

    it('shadows', () => {
      const pairs: [string, string, Vars?][] = [
        ['raised-shadow', t.kinds.btn.n.sh], ['raised-shadow-hover', t.kinds.btn.h.sh], ['raised-shadow-pressed', t.kinds.btn.p.sh],
        ['raised-sm-shadow', t.kinds.ib.n.sh], ['raised-sm-shadow-hover', t.kinds.ib.h.sh], ['raised-sm-shadow-pressed', t.kinds.ib.p.sh],
        ['raised-sm-shadow', t.kinds.add.n.sh], ['raised-sm-shadow-hover', t.kinds.add.h.sh], ['raised-sm-shadow-pressed', t.kinds.add.p.sh],
        ['card-shadow', t.cardSh], ['pill-shadow', t.pillSh], ['pill-shadow-selected', t.pillSelSh],
        ['flat-shadow', t.kinds.step.n.sh], ['flat-shadow', t.kinds.step.h.sh], ['step-shadow-pressed', t.kinds.step.p.sh],
        ['flat-shadow', t.stepSel.n.sh], ['flat-shadow', t.stepSel.h.sh], ['selected-step-shadow-pressed', t.stepSel.p.sh],
        ['glass-shadow', t.popSh],
        ['hover-shadow', t.painted.n.sh, pv.accent], ['hover-shadow', t.painted.h.sh, pv.accent], ['active-shadow', t.painted.p.sh, pv.accent],
        ['hover-shadow', t.paintedDanger.n.sh, pv.destructive], ['hover-shadow', t.paintedDanger.h.sh, pv.destructive],
        ['active-shadow', t.paintedDanger.p.sh, pv.destructive],
      ]
      const problems = pairs.flatMap(([name, value, vars]) => {
        const p = shadowProblem(shadows(value), shadows(`var(--${name})`, vars ?? v))
        return p ? [`--${name}: ${p}`] : []
      })
      // Flat things had no shadow; sheets had Tailwind's shadow-lg (DialogContent), the ghost none.
      for (const [name, value] of [['hdrSh', t.hdrSh], ['photoSh', t.photoSh], ['thumbSh', t.thumbSh], ['chipSh', t.chipSh], ['curSh', t.curSh], ['fieldSh', t.fieldSh], ['tipSh', t.tipSh]]) {
        if (value !== 'none') problems.push(`${name} ${value}`)
      }
      for (const s of ['n', 'h', 'p'] as const) if (t.kinds.ghost[s].sh !== 'none') problems.push(`ghost.${s}.sh`)
      // Plan 12 (F5): lists lie in a concave panel — the raised button's pair (R(4, 10)) turned inward.
      const raised = shadows('var(--raised-shadow)', v).slice(0, 2)
      const sunk = shadows(t.listSh).filter((x) => x.color.a > 0)
      const lp = shadowProblem(sunk, raised.map((x) => ({ ...x, inset: true })))
      if (lp) problems.push(`listSh: ${lp}`)
      const lg = /--shadow-lg:\s*([^;]+);/.exec(readFileSync(createRequire(import.meta.url).resolve('tailwindcss/theme.css'), 'utf8'))![1]!
      const p = shadowProblem(shadows(t.sheetSh), shadows(lg.replace(/rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g, 'rgba($1, $2, $3, $4)')))
      if (p) problems.push(`sheetSh: ${p}`)
      expect(problems).toEqual([])
    })

    it('glass, radii, motion, type, surfaces without a colour of their own', () => {
      const glassImg = flat(substitute('var(--glass-img)', v))
      expect(flat(topLevel(t.pop).slice(0, -1).join(', '))).toBe(glassImg)
      expect(t.popBlur).toBe(flat(substitute('var(--glass-blur)', v)))
      expect(old.theme['radius-card']).toBe('20px')
      expect(old.theme['radius-field']).toBe('14px')
      expect(old.theme['radius-chip']).toBe('10px')
      for (const r of [t.cardR, t.popR, t.photoR]) expect(r).toBe('20px')
      // Every control and tile was --radius-field (.pressable included); menu items rounded-field.
      for (const r of [t.btnR, t.ibR, t.primR, t.ghostR, t.pillR, t.curR, t.popItemR, t.thumbR]) expect(r).toBe('14px')
      expect(t.smallR).toBe('10px')
      expect(t.pillRL).toBe('14px 0 0 14px')
      expect(t.pillRR).toBe('0 14px 14px 0')
      expect(t.tr).toBe(flat(/\.pressable \{[^}]*transition:([^;]*);/.exec(oldCss)![1]!))
      const scale = (utility: string) => /--active-scale:\s*([\d.]+)/.exec(ruleBody(oldCss, utility))?.[1]
      const pressTf = (s: string | undefined) => (s ? `scale(${s})` : 'none')
      expect(t.kinds.btn.p.tf).toBe(pressTf(scale('.raised')))
      expect(t.kinds.ib.p.tf).toBe(pressTf(scale('.raised-sm')))
      expect(t.kinds.add.p.tf).toBe(pressTf(scale('.raised-sm')))
      // Plan 12 (F5): the accent button (the FAB) is painted in the accent in both themes, like .painted (its colours and
      // shadows are checked against the old .painted above); before, light was a soft tint with accent ink.
      expect(t.kinds.primary).toEqual(t.painted)
      expect(t.painted.p.tf).toBe(pressTf(scale('.painted')))
      expect(t.paintedDanger.p.tf).toBe(pressTf(scale('.painted')))
      expect([t.kinds.step.p.tf, t.kinds.ghost.p.tf, t.stepSel.p.tf]).toEqual(['none', 'none', 'none'])
      for (const kind of [...KINDS, 'stepSel', 'ghostSel', 'painted', 'paintedDanger'] as const) {
        for (const s of ['n', 'h', 'p'] as const) {
          expect(k(t, kind)[s].img, `${kind}.${s}.img`).toBe('none')
          if (s !== 'p') expect(k(t, kind)[s].tf, `${kind}.${s}.tf`).toBe('none')
        }
      }
      expect(t.ghostSel).toEqual({ ...t.kinds.ghost, n: { ...t.kinds.ghost.n, fg: t.curMuted } })
      // The old literal, as @nuxt/fonts rewrote it: its metric-matched fallbacks between Manrope and system-ui.
      const [family, ...generic] = flat(/body \{[^}]*font-family:\s*([^;]+);/.exec(oldCss)![1]!).split(', ')
      expect(t.font.startsWith(`${family}, "Manrope Fallback: `)).toBe(true)
      expect(t.font.endsWith(`", ${generic.join(', ')}`)).toBe(true)
      expect([t.headFont, t.labelFont]).toEqual([t.font, t.font])
      expect([t.headWeight, t.headTrack, t.headCase, t.labelWeight, t.labelCase, t.mark]).toEqual(['700', '-0.02em', 'none', '600', 'none', ''])
      expect([t.numFont, t.chipFont, t.stroke, t.cap, t.join]).toEqual(['inherit', 'inherit', '2', 'round', 'round'])
      // Weights as the markup had them: amounts and emphasised actions font-bold, other buttons font-medium.
      expect([t.numWeight, t.btnWeight, t.plainBtnWeight]).toEqual(['700', '700', '500'])
      expect(t.barSh).toBe('none')
      expect([t.winBg, t.winBlur, t.hdrBlur, t.surfBlur, t.ctrlBlur, t.sheetBlur, t.led]).toEqual(['transparent', 'none', 'none', 'none', 'none', 'none', false])
      // Plan 12 (F5): the list's concave panel is rounded like a card (before: rows on the page, radius 0).
      expect([t.list, t.listR, t.curM, t.pillImg, t.hdr]).toEqual(['transparent', '20px', '0', 'none', t.pageColor])
      expect(t.overlay).toBe('rgba(0, 0, 0, 0.8)')
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('applying a style (Review Focus 1)', () => {
  it('one <style id="antresol-style"> with both themes, data-style on <html>, nothing of the previous style left', () => {
    const root = fakeRoot()
    applyStyle(root.el, 'neumorphism', 'indigo')
    expect(root.head.filter((e) => e.id === STYLE_ELEMENT_ID)).toHaveLength(1)
    expect(root.attributes.get('data-style')).toBe('neumorphism')
    const a = styleCss('neumorphism', 'indigo')
    const b = styleCss('base', 'rose')
    expect(a).not.toBe(b)

    applyStyle(root.el, 'base', 'rose')
    const elements = root.head.filter((e) => e.id === STYLE_ELEMENT_ID)
    expect(elements).toHaveLength(1)
    expect(elements[0]!.tagName).toBe('STYLE')
    expect(elements[0]!.textContent).toBe(b)
    expect(root.attributes.get('data-style')).toBe('base')
    expect([...root.attributes.keys()]).toEqual(['data-style'])
    // No variable is written on <html> itself (an inline one would outlive the style element).
    expect(root.inline.size).toBe(0)
    // Every declaration is the new style's.
    const decls = (s: string) => new Set(s.match(/--st-[\w-]+:[^;}]*/g))
    expect([...decls(elements[0]!.textContent)].filter((d) => !decls(b).has(d))).toEqual([])
  })

  it('both themes declare the same variables, so a theme switch never leaves one unset', () => {
    for (const name of STYLE_NAMES) {
      const text = styleCss(name, STYLES[name].defaultAccent)
      const m = /^:root\{(.*)\}\.dark\{(.*)\}$/.exec(text)
      expect(m, name).not.toBeNull()
      const names = (body: string) => body.split(';').map((d) => d.slice(0, d.indexOf(':')))
      expect(names(m![1]!), name).toEqual(names(m![2]!))
    }
  })

  it('names: --st-<key>, --st-<kind>-<state>-<prop>, lists by index, the mark as a CSS string', () => {
    const vars = new Map(styleVars(neumorphism('light', 'indigo')))
    for (const name of ['--st-page', '--st-pop-hover-fg', '--st-pill-r-l', '--st-primary-h-bg', '--st-step-sel-p-sh', '--st-ghost-sel-n-fg', '--st-painted-danger-p-tf', '--st-chips-0', '--st-chip-fgs-0', '--st-thumbs-0', '--st-card-solid', '--st-led', '--st-page-color']) {
      expect(vars.has(name), name).toBe(true)
    }
    expect(vars.get('--st-mark')).toBe('none')
    expect(vars.get('--st-led')).toBe('0')
    const marked = styleVars({ ...neumorphism('light', 'indigo'), mark: '✦ ' })
    expect(new Map(marked).get('--st-mark')).toBe('"✦ "')
    expect(() => styleVars({ ...neumorphism('light', 'indigo'), fg: 'red; color: blue' })).toThrow()
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Contrast (spec §8): every style × theme × accent (a fixed palette: its own) — text and icons at 4.5:1 or better.

/** A layer with a size (`/ 12px 1.5px`) or `no-repeat` is a drawing (ticks, dots), not something text sits on. */
const decoration = (layer: string) => /\/\s*[\d.]+(px|%)/.test(layer) || /no-repeat/.test(layer)
/**
 * The colours a background can show behind text: its bottom layer (a colour, or each stop of a gradient), with the
 * plain colours layered above it drawn over; gradient layers above the bottom one are highlights (spec, gloss, grain)
 * and drawings are skipped. Drawn over each of `under`.
 */
function backdrops(background: string, under: Rgba[]): Rgba[] {
  const layers = topLevel(background).filter((l) => !decoration(l))
  const bottom = layers.at(-1) ?? 'transparent'
  const plain = parseColor0(bottom)
  let out: Rgba[] = (plain ? [plain] : stops(bottom)).flatMap((c) => under.map((u) => over(c, u)))
  for (const layer of layers.slice(0, -1).reverse()) {
    const c = parseColor0(layer)
    if (c) out = out.map((u) => over(c, u))
  }
  const seen = new Set<string>()
  return out.filter((c) => {
    const key = [c.r, c.g, c.b, c.a].map((x) => x.toFixed(1)).join()
    return seen.has(key) ? false : (seen.add(key), true)
  })
}
const parseColor0 = (s: string): Rgba | null => {
  try {
    return parseColor(s)
  } catch {
    return null
  }
}
const stops = (gradient: string): Rgba[] => [...gradient.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|\btransparent\b/g)].map((m) => parseColor(m[0]))
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

/**
 * `neumorphismGhostSel`: Neumorphism's (and the stubs', which draw it) "⋯" in a selected row on hover and open is
 * 3.9–4.5:1 since before styles — a known exception (plan 10 Task 1 report, concern 1), checked for no other style.
 */
function contrastProblems(t: StyleTokens, neumorphismGhostSel = false, stateInk: StateInk = { h: false, p: false }, cardInk: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = []
  const page = backdrops(`${t.winBg}, ${t.page}`, [WHITE])
  const on = (bg: string, under: Rgba[]) => backdrops(bg, under)
  const card = on(t.card, page)
  const list = on(t.list, page)
  const pop = on(t.pop, page)
  const cur = on(t.cur, list)
  const check = (label: string, fg: string, bgs: Rgba[]) => {
    const f = parseColor0(fg)
    if (!f) return void problems.push(`${label}: ${fg} is not a colour`)
    for (const b of bgs) {
      const c = contrast(over(f, b), b)
      if (c < 4.5) problems.push(`${label}: ${fg} on rgba(${[b.r, b.g, b.b].map(Math.round)},${b.a.toFixed(2)}) = ${c.toFixed(2)}`)
    }
  }
  for (const [name, surface] of [['page', page], ['list', list], ['pop', pop]] as const) {
    for (const text of ['fg', 'muted', 'icon'] as const) check(`${text} on ${name}`, t[text], surface)
  }
  // A card's text is the card's: main.css gives every card cardMuted, and a style whose CSS re-points a colour inside
  // `.raised-card` (Neo-brutal's Memphis cards: ink in both themes, where its dark page text is light) draws cardFg there
  // instead (cardInk, read from the style's own CSS). What its CSS does not re-point is the page's own colour.
  const onCard = (variable: string, own: string) => (cardInk.has(variable) ? { label: 'cardFg', value: t.cardFg } : { label: own, value: t[own as 'fg'] })
  for (const [variable, own] of [['--foreground', 'fg'], ['--icon', 'icon'], ['--accent-ink', 'ink'], ['--destructive', 'destructive'], ['--warning', 'warning']] as const) {
    const c = onCard(variable, own)
    check(`${c.label} (${own}) on card`, c.value, card)
  }
  check('subtle on page', t.subtle, page)
  check('dimmed on page', t.dimmed, page)
  check('ink on page', t.ink, page)
  check('ink on list', t.ink, list)
  check('destructive on page', t.destructive, page)
  check('warning on page', t.warning, page)
  check('destructive on list', t.destructive, list)
  check('warning on list', t.warning, list)
  check('cardFg on card', t.cardFg, card)
  check('cardMuted on card', t.cardMuted, card)
  check('curFg on cur', t.curFg, cur)
  check('curMuted on cur', t.curMuted, cur)
  check('popFg on pop', t.popFg, pop)
  check('popMuted on pop', t.popMuted, pop)
  check('popDanger on pop', t.popDanger, pop)
  const hovered = on(t.popHover, pop)
  check('popHoverFg on popHover', t.popHoverFg, hovered)
  check('popMuted on popHover', t.popMuted, hovered)
  check('popDanger on popHover', t.popDanger, hovered)
  check('fg on rowHover', t.fg, on(t.rowHover, list))
  check('muted on rowHover', t.muted, on(t.rowHover, list))
  check('fg on field', t.fg, on(t.field, page))
  check('muted on field', t.muted, on(t.field, page))
  check('fg on sheet', t.fg, on(t.sheet, page))
  check('muted on sheet', t.muted, on(t.sheet, page))
  // Sheets and dialogs are shown over the overlay scrim, as composited: page, then the scrim, then the sheet (a blur
  // averages what is behind it, so the colours are the same). Everything a sheet holds is checked on that.
  const scrim = on(t.overlay, page)
  const sheet = on(t.sheet, scrim)
  for (const text of ['fg', 'muted', 'icon', 'subtle', 'ink', 'destructive', 'warning'] as const) check(`${text} on sheet over the scrim`, t[text], sheet)
  check('fg on field in a sheet', t.fg, on(t.field, sheet))
  check('muted on field in a sheet', t.muted, on(t.field, sheet))
  check('fg on chip in a sheet', t.fg, on(t.chip, sheet))
  check('fg on rowHover in a sheet', t.fg, on(t.rowHover, sheet))
  check('accentSoftFg on accentSoft in a sheet', t.accentSoftFg, on(t.accentSoft, sheet))
  for (const kind of ['ib', 'btn', 'primary', 'ghost', 'painted', 'paintedDanger'] as const) {
    for (const s of ['n', 'h', 'p'] as const) {
      const state = k(t, kind)[s]
      const fill = on(state.bg, sheet)
      check(`${kind}.${s}.fg in a sheet`, state.fg, state.img === 'none' ? fill : backdrops(state.img, fill))
    }
  }
  check('fg on surface', t.fg, on(t.surface, page))
  check('fg on rail', t.fg, on(t.rail, page))
  check('fg on chip', t.fg, on(t.chip, page))
  check('muted on chip', t.muted, on(t.chip, page))
  check('thumbFg on thumb', t.thumbFg, on(t.thumb, page))
  check('photoFg on photo', t.photoFg, on(t.photo, page))
  check('accentSoftFg on accentSoft', t.accentSoftFg, on(t.accentSoft, page))
  check('primaryFg on primary', t.primaryFg, on(t.primary, page))
  check('tipFg on tip', t.tipFg, on(t.tip, page))
  check('destructiveFg on destructive', t.destructiveFg, on(t.destructive, page))
  // Tag chips and thumbnails cycle their colours independently: every pair that can meet.
  const n = Math.max(t.chips.length, t.chipFgs.length) * Math.min(t.chips.length, t.chipFgs.length)
  for (let i = 0; i < n; i++) check(`chipFgs[${i % t.chipFgs.length}] on chips[${i % t.chips.length}]`, t.chipFgs[i % t.chipFgs.length]!, on(t.chips[i % t.chips.length]!, page))
  t.thumbs.forEach((thumb, i) => check(`thumbFg on thumbs[${i}]`, t.thumbFg, on(thumb, page)))
  // statusOut is not paired: the word "Out" always stands beside the dot, so its colour is decorative.
  // Controls: the text of each state on its fill (and image), over what the control sits on.
  const pill = on(t.pillBg, page)
  const pillSel = on(t.pillSelBg, cur)
  // The count and the unit inside the stepper (a variant row): the row's own text, over the pill's fill, over the row.
  // On a selected row that is curFg / curMuted over pillSelBg over the selected tint over the list; otherwise fg / muted
  // over pillBg over the list.
  check('curFg on pillSelBg over cur (the count on a selected row)', t.curFg, pillSel)
  check('curMuted on pillSelBg over cur (the unit on a selected row)', t.curMuted, pillSel)
  const pillOnList = on(t.pillBg, list)
  check('fg on pillBg over list (the count)', t.fg, pillOnList)
  check('muted on pillBg over list (the unit)', t.muted, pillOnList)
  // The toast's action ("Undo") is the btn kind on the menu colour: the toast's text over each state's fill.
  const toast = backdrops(t.popSolid, [WHITE])
  for (const s of ['n', 'h', 'p'] as const) {
    const state = t.kinds.btn[s]
    const fill = on(state.bg, toast)
    check(`btn.${s} text over popSolid (the toast's action)`, s === 'n' ? t.popFg : state.fg, state.img === 'none' ? fill : backdrops(state.img, fill))
  }
  const under: Record<string, Rgba[]> = { step: pill, ghost: list, stepSel: pillSel, ghostSel: cur }
  for (const kind of [...KINDS, 'stepSel', 'ghostSel', 'painted', 'paintedDanger'] as const) {
    for (const s of kind === 'ghostSel' && neumorphismGhostSel ? (['n'] as const) : (['n', 'h', 'p'] as const)) {
      const state = k(t, kind)[s]
      const fill = on(state.bg, under[kind] ?? page)
      check(`${kind}.${s}.fg`, state.fg, state.img === 'none' ? fill : backdrops(state.img, fill))
    }
  }
  // The row menu "⋯" draws its hover and open text in the markup's accent ink (hover:text-accent-ink,
  // data-[state=open]:text-accent-ink) on the ghost tints (in a selected row, ghostSel's).
  // A style whose own CSS re-points that ink to the state's text (stateInk) draws the state's fg there instead.
  for (const s of ['h', 'p'] as const) {
    const ghostInk = stateInk[s] ? t.kinds.ghost[s].fg : t.ink
    const selInk = stateInk[s] ? t.ghostSel[s].fg : t.ink
    check(`${stateInk[s] ? `ghost.${s}.fg` : 'ink'} on ghost.${s}.bg (row menu)`, ghostInk, on(t.kinds.ghost[s].bg, list))
    if (!neumorphismGhostSel) check(`${stateInk[s] ? `ghostSel.${s}.fg` : 'ink'} on ghostSel.${s}.bg (row menu in a selected row)`, selInk, on(t.ghostSel[s].bg, cur))
  }
  return problems
}

interface StateInk {
  h: boolean
  p: boolean
}
/** Whether the style's own CSS (assets/css/styles/<name>.css) re-points --accent-ink on a hovered (h) or pressed and
 *  open (p) control to that state's text colour (Neo-brutal: ink on its Memphis fills, where no accent reads in the
 *  dark theme): the row menu's "⋯" then shows that colour, not the accent ink. */
function stateInkOf(name: StyleName): StateInk {
  const code = styleCode(name)
  return { h: code.includes('--accent-ink: var(--h-fg)'), p: code.includes('--accent-ink: var(--p-fg)') }
}
/** The style's own CSS without comments ('' when it has none). */
function styleCode(name: StyleName): string {
  const path = fileURLToPath(new URL(`../app/assets/css/styles/${name}.css`, import.meta.url))
  return existsSync(path) ? readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') : ''
}
/** The colour variables the style's CSS re-points on the card itself (a rule for `[data-style='x'] .raised-card`, alone or in
 *  an :is() list): inside a card the text then takes the card's colours (cardFg), not the page's. */
function cardInkOf(name: StyleName): Set<string> {
  const out = new Set<string>()
  for (const m of styleCode(name).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`\\[data-style='${name}'\\]\\s+(:is\\([^)]*\\.raised-card[^)]*\\)|\\.raised-card)\\s*$`).test(m[1]!.trim())) continue
    for (const v of m[2]!.matchAll(/(--[\w-]+)\s*:/g)) out.add(v[1]!)
  }
  return out
}

describe.each(STYLE_NAMES)('contrast: %s', (name) => {
  const info = STYLES[name]
  const stateInk = stateInkOf(name)
  const cardInk = cardInkOf(name)
  const accents: AccentName[] = info.fixedPalette ? [info.defaultAccent] : ACCENT_NAMES
  it.each(MODES.flatMap((mode) => accents.map((accent) => [mode, accent] as const)))('%s, %s: every text on its background at 4.5:1 or better', (mode, accent) => {
    const t = info.build(mode, accent)
    // Neumorphism's own tokens (itself, or a stub that still draws it) carry the one known exception.
    const own = name === 'neumorphism' || JSON.stringify(t) === JSON.stringify(neumorphism(mode, effectiveAccent(name, accent)))
    expect(contrastProblems(t, own, stateInk, cardInk)).toEqual([])
  })
})

describe('the contrast gate', () => {
  it('a style other than Neumorphism is held to its selected row\'s "⋯" too', () => {
    const t = neumorphism('light', 'blue')
    expect(contrastProblems(t, true)).toEqual([])
    expect(contrastProblems(t).some((p) => p.startsWith('ghostSel.p.fg') || p.startsWith('ink on ghostSel'))).toBe(true)
  })
})

describe('the contrast gate, composited layers and the card exemption (plan 10 final review)', () => {
  it('the count on a selected row is checked over the pill over the row tint: a white lift under it is caught', () => {
    const t = STYLES.liquid.build('dark', 'blue')
    expect(contrastProblems(t)).toEqual([])
    // The pill's white lift (what Liquid dark had: pillBg's 10 % on the selected row) takes the accent ink under 4.5:1.
    const lifted = { ...t, pillSelBg: 'rgba(255,255,255,0.1)' }
    expect(contrastProblems(lifted).some((p) => p.startsWith('curFg on pillSelBg over cur'))).toBe(true)
  })

  it('the card exemption follows the CSS: only Neo-brutal re-points colours inside .raised-card', () => {
    for (const name of STYLE_NAMES) {
      const re = cardInkOf(name)
      if (name === 'brutal') expect([...re].sort(), name).toEqual(expect.arrayContaining(['--foreground', '--icon', '--accent-ink', '--destructive']))
      else expect([...re], name).toEqual([])
    }
    // A style whose card text differs but whose CSS re-points nothing is held to the page's colours: no silent skip.
    const t = { ...STYLES.base.build('light', 'indigo'), cardFg: '#111111' }
    expect(contrastProblems({ ...t, fg: '#DDDDDD', ink: '#DDDDDD' })).not.toEqual([])
    // Ink, destructive and warning are checked on the card.
    const weak = { ...STYLES.base.build('light', 'indigo'), destructive: '#FF8080' }
    expect(contrastProblems(weak).some((p) => p.includes('(destructive) on card'))).toBe(true)
    expect(contrastProblems({ ...weak, destructive: STYLES.base.build('light', 'indigo').destructive }).filter((p) => p.includes('on card'))).toEqual([])
  })
})

/**
 * Field outlines (WCAG 1.4.11, non-text contrast 3:1): the 1 px outline of text fields, textareas, select triggers and
 * the Camera / Gallery buttons (--input) against every surface they sit on. Acrylic, Liquid and Y2K had a 1.1–1.2:1
 * hairline and now pass; the other six styles keep their owner-approved outlines (1.3–1.5:1, or ink lines), which this
 * does not hold them to.
 */
function fieldRingProblems(t: StyleTokens): string[] {
  const page = backdrops(`${t.winBg}, ${t.page}`, [WHITE])
  const scrim = backdrops(t.overlay, page)
  const line = parseColor0(t.fieldLine)
  if (!line) return [`fieldLine ${t.fieldLine} is not a colour`]
  const problems: string[] = []
  for (const [name, bgs] of [
    ['page', page],
    ['card', backdrops(t.card, page)],
    ['list', backdrops(t.list, page)],
    ['photo', backdrops(t.photo, page)],
    ['sheet', backdrops(t.sheet, page)],
    ['sheet over the scrim', backdrops(t.sheet, scrim)],
  ] as const) {
    for (const b of bgs) {
      const c = contrast(over(line, b), b)
      if (c < 3) problems.push(`fieldLine ${t.fieldLine} on ${name} = ${c.toFixed(2)}`)
    }
  }
  return problems
}
const FIELD_RING_3_1: StyleName[] = ['acrylic', 'liquid', 'y2k']
describe.each(FIELD_RING_3_1)('field outline at 3:1: %s', (name) => {
  it.each(MODES.flatMap((mode) => ACCENT_NAMES.map((accent) => [mode, accent] as const)))('%s, %s', (mode, accent) => {
    expect(fieldRingProblems(STYLES[name].build(mode, accent))).toEqual([])
  })
  it('the check bites: the style\'s old hairline fails it', () => {
    expect(fieldRingProblems({ ...STYLES[name].build('light', 'blue'), fieldLine: 'rgba(20,24,40,0.08)' }).length).toBeGreaterThan(0)
  })
})

/**
 * A selected radio (plan 13, item 1): its ring (border-primary) and dot (fill-primary) are --primary, drawn on the
 * field's fill over the surface the group sits on. Both read at 3:1 (WCAG 1.4.11) on page, card, list and sheet.
 * Liquid dark's primary was the accent at 86 % over the dark wallpaper: too dark to see on the grey glass.
 */
function radioProblems(t: StyleTokens, cardPrimary = false): string[] {
  const primary = parseColor0(t.primary)
  const fieldFill = parseColor0(t.field)
  if (!primary) return [`primary ${t.primary} is not a colour`]
  const page = backdrops(`${t.winBg}, ${t.page}`, [WHITE])
  const problems: string[] = []
  for (const [name, bgs] of [
    ['page', page],
    ['card', backdrops(t.card, page)],
    ['list', backdrops(t.list, page)],
    ['sheet', backdrops(t.sheet, page)],
  ] as const) {
    // Neo-brutal's CSS re-points --primary (ink) and --field (paper) on a card; the other surfaces use the tokens.
    const onCard = name === 'card' && cardPrimary
    const ringC = onCard ? parseColor0(t.cardFg)! : primary
    const fill = onCard ? WHITE : fieldFill
    for (const b of bgs) {
      const ring = contrast(over(ringC, b), b)
      if (ring < 3) problems.push(`radio ring ${t.primary} on ${name} = ${ring.toFixed(2)}`)
      if (fill) {
        const inside = over(fill, b)
        const dot = contrast(over(ringC, inside), inside)
        if (dot < 3) problems.push(`radio dot ${t.primary} on field over ${name} = ${dot.toFixed(2)}`)
      }
    }
  }
  return problems
}
// Every style: a selected radio reads as selected everywhere.
describe.each(STYLE_NAMES)('selected radio at 3:1: %s', (name) => {
  const accents: AccentName[] = STYLES[name].fixedPalette ? [STYLES[name].defaultAccent] : ACCENT_NAMES
  it.each(MODES.flatMap((mode) => accents.map((accent) => [mode, accent] as const)))('%s, %s', (mode, accent) => {
    expect(radioProblems(STYLES[name].build(mode, accent), cardInkOf(name).has('--primary'))).toEqual([])
  })
})
it('the radio check bites: a dark accent on dark glass fails it', () => {
  expect(radioProblems({ ...STYLES.liquid.build('dark', 'indigo'), primary: '#2A2F6B' }).length).toBeGreaterThan(0)
})

describe('fixed palettes ignore the accent they are given', () => {
  it.each(STYLE_NAMES.filter((n) => STYLES[n].fixedPalette))('%s', (name) => {
    const { build, defaultAccent } = STYLES[name]
    for (const mode of MODES) for (const accent of ACCENT_NAMES) expect(build(mode, accent), `${mode} ${accent}`).toEqual(build(mode, defaultAccent))
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('a style changes no layout (Review Focus 3)', () => {
  it.each(STYLE_NAMES)('%s: no padding, margin, gap, width, height or border-width in any token; lines are 1 px', (name) => {
    for (const mode of MODES) {
      const t = STYLES[name].build(mode, STYLES[name].defaultAccent)
      for (const [variable, value] of styleVars(t)) {
        expect(value, variable).not.toMatch(/padding|margin|gap|width:|height:|border-width/i)
      }
      expect(t.divider, 'divider').toMatch(/^1px (solid|dashed|dotted) \S/)
      expect(t.seam, 'seam').toMatch(/^1px (solid|dashed|dotted) \S/)
      // The selected row's inset is drawn (an `inset` of its background), never negative: it cannot grow the row.
      expect(t.curM, 'curM').toMatch(/^0(\s+[\d.]+px)?$/)
    }
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('style CSS changes no layout (Review Focus 3, every assets/css/styles/*.css)', () => {
  const dir = fileURLToPath(new URL('../app/assets/css/styles/', import.meta.url))
  const files = readdirSync(dir).filter((f) => f.endsWith('.css'))
  /** Declarations of every rule, with the selector: `{ selector, name, value }`. */
  function declarations(code: string): { selector: string; name: string; value: string }[] {
    const out: { selector: string; name: string; value: string }[] = []
    for (const m of code.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const d of m[2]!.split(';')) {
        const i = d.indexOf(':')
        if (i > 0) out.push({ selector: m[1]!.trim(), name: d.slice(0, i).trim(), value: d.slice(i + 1).trim() })
      }
    }
    return out
  }
  const LAYOUT = /^(padding|margin|gap|row-gap|column-gap|width|height|min-width|max-width|min-height|max-height|inline-size|block-size|border(-top|-right|-bottom|-left)?(-width)?|border-(inline|block)(-start|-end)?(-width)?|inset|top|right|bottom|left|display|flex|grid|float|line-height|font-size)$/
  it('there is a CSS file for every style that has one', () => {
    expect(files.length).toBeGreaterThanOrEqual(8)
  })
  it.each(files)('%s: no padding, margin, gap, width, height or border-width outside an absolutely positioned drawing', (file) => {
    const code = readFileSync(join(dir, file), 'utf8')
    const rules = [...code.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const bad: string[] = []
    for (const [, selector, body] of rules) {
      const drawn = /position\s*:\s*absolute/.test(body!) || /::(before|after)/.test(selector!)
      for (const d of declarations(`${selector}{${body}}`)) {
        // Sizes of a drawing (a pseudo-element, or a box positioned absolutely) are not layout.
        if (drawn && /^(width|height|top|right|bottom|left|inset|display)$/.test(d.name)) continue
        // The divider token is a 1 px line (asserted above): a rule that draws the divider as a border is not a width.
        if (/^border(-top|-bottom)?$/.test(d.name) && d.value === 'var(--st-divider)') continue
        if (/^(padding|margin|gap|row-gap|column-gap|width|height|min-width|max-width|min-height|max-height|border-width)/.test(d.name) || /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?$/.test(d.name) || /(^|\s)(width|height|padding|margin|gap)\s*:/.test(d.value)) bad.push(`${selector!.trim()} { ${d.name}: ${d.value} }`)
      }
    }
    expect(bad).toEqual([])
  })
  it('the scan bites: padding, a margin, a gap, a width, a height and a border width are all caught', () => {
    const probe = (decl: string) => /^(padding|margin|gap|width|height|border(-top)?)/.test(decl)
    for (const d of ['padding: 4px', 'margin: 0 4px', 'gap: 2px', 'width: 10px', 'height: 10px', 'border-width: 2px', 'border-top: 1px solid red']) expect(probe(d), d).toBe(true)
    void LAYOUT
  })
})

describe('apply: a token that is not a string is a bug in a style module (final review M9)', () => {
  it('styleVars throws for undefined, numbers and null', () => {
    const t = STYLES.base.build('light', 'indigo')
    for (const bad of [undefined, 12, null]) expect(() => styleVars({ ...t, fg: bad as unknown as string }), String(bad)).toThrow(/must not contain|Style token/)
  })
  it('a style that builds a missing token falls back to Base, like one that throws', async () => {
    const real = STYLES.liquid.build
    STYLES.liquid.build = ((mode, accent) => ({ ...real(mode, accent), muted: undefined as unknown as string })) as typeof real
    try {
      const db = createMemoryDeviceDb()
      await db.putSettings({ style: 'liquid' })
      const root = fakeRoot()
      const a = createAppearance(db, root.el)
      await expect(a.load()).resolves.toBeUndefined()
      expect(a.style.value).toBe('base')
      expect(root.attributes.get('data-style')).toBe('base')
      expect(await db.getSettings()).toMatchObject({ style: 'liquid' })
    } finally {
      STYLES.liquid.build = real
    }
  })
})

describe('dark sheets and the drawer keep a visible edge (final review)', () => {
  it('every style but the two that draw their own gets the 16 % white rim in dark, and none in light', () => {
    for (const name of STYLE_NAMES) {
      const [light, dark] = MODES.map((mode) => STYLES[name].build(mode, STYLES[name].defaultAccent).sheetLine)
      if (name === 'brutal' || name === 'neumorphism') {
        expect(dark, name).not.toBe('rgba(255,255,255,0.16)')
        expect(dark, name).not.toBe('transparent')
      } else {
        expect(dark, name).toBe('rgba(255,255,255,0.16)')
        expect(light, name).toBe('transparent')
      }
    }
  })
  it('the drawer takes it in main.css for every style but Neumorphism and Neo-brutal (brutal.css: 2 px)', () => {
    expect(code0(css)).toMatch(/\.dark:not\(\[data-style='neumorphism'\], \[data-style='brutal'\]\) #nav-drawer\s*\{\s*box-shadow: inset -1px 0 0 var\(--st-sheet-line\)/)
    expect(styleCode('brutal')).toMatch(/\.dark\[data-style='brutal'\] #nav-drawer\s*\{\s*box-shadow: inset -2px 0 0 var\(--st-sheet-line\)/)
  })
})

/** CSS without comments. */
function code0(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('section marks on engines without alt text in content (final review)', () => {
  it('a plain content declaration stands for them; the alt-text one is behind @supports', () => {
    const c = code0(css)
    const plain = c.indexOf('.section-label::before {')
    expect(c.slice(plain, c.indexOf('}', plain))).toMatch(/content: var\(--st-mark\);/)
    expect(c).toMatch(/@supports \(content: 'a' \/ 'b'\) \{\s*\.section-label::before \{\s*content: var\(--st-mark\) \/ '';/)
  })
})

describe('toasts follow the style (final review)', () => {
  it('the toast takes the menus\' shadow and its action is the btn kind', () => {
    const c = code0(css)
    expect(c).toMatch(/\[data-sonner-toast\]\[data-styled='true'\] \{\s*box-shadow: var\(--st-pop-sh\);/)
    const action = /\[data-button\] \{([^}]*)\}/.exec(c)![1]!
    for (const v of ['--st-btn-r', '--st-btn-n-bg', '--st-btn-n-img', '--st-btn-n-sh']) expect(action, v).toContain(v)
  })
})

describe('appearance (device setting)', () => {
  const settings = async (patch: Partial<DeviceSettings>) => {
    const db = createMemoryDeviceDb()
    await db.putSettings(patch)
    return db
  }

  it('rose in Base → Retro draws teal → Base again draws rose (Review Focus 4)', async () => {
    const db = await settings({})
    const root = fakeRoot()
    const a = createAppearance(db, root.el)
    await a.load()
    await a.setAccent('rose')
    expect(a.effectiveAccent.value).toBe('rose')
    await a.setStyle('retro')
    expect(a.style.value).toBe('retro')
    expect(a.effectiveAccent.value).toBe('teal')
    expect(a.accent.value).toBe('rose')
    expect(root.head[0]!.textContent).toBe(styleCss('retro', 'teal'))
    await a.setStyle('base')
    expect(a.effectiveAccent.value).toBe('rose')
    expect(root.head[0]!.textContent).toBe(styleCss('base', 'rose'))
    expect(await db.getSettings()).toMatchObject({ style: 'base', accent: 'rose' })
  })

  it('no stored style, or one this app does not know, is Base; an unknown value stays stored', async () => {
    const fresh = createAppearance(await settings({}), fakeRoot().el)
    await fresh.load()
    expect(fresh.style.value).toBe(DEFAULT_STYLE)

    const db = await settings({ style: 'material' as StyleName, accent: 'neon' as AccentName })
    const root = fakeRoot()
    const later = createAppearance(db, root.el)
    await later.load()
    expect(later.style.value).toBe('base')
    expect(later.accent.value).toBeNull()
    expect(root.attributes.get('data-style')).toBe('base')
    expect(await db.getSettings()).toMatchObject({ style: 'material', accent: 'neon' })
  })

  it('load applies the stored style and accent; "Style default" is null and draws the style\'s accent', async () => {
    const root = fakeRoot()
    const a = createAppearance(await settings({ style: 'tinkerer', accent: 'green' }), root.el)
    await a.load()
    expect([a.style.value, a.accent.value, a.effectiveAccent.value]).toEqual(['tinkerer', 'green', 'green'])
    expect(root.attributes.get('data-style')).toBe('tinkerer')
    await a.setAccent(null)
    expect([a.accent.value, a.effectiveAccent.value]).toEqual([null, 'copper'])
    expect(root.head[0]!.textContent).toBe(styleCss('tinkerer', 'copper'))
  })

  it('a stored accent from before styles (always the user\'s own choice) is kept', async () => {
    const a = createAppearance(await settings({ accent: 'teal' }), fakeRoot().el)
    await a.load()
    expect([a.style.value, a.accent.value, a.effectiveAccent.value]).toEqual(['base', 'teal', 'teal'])
  })

  it('load survives a failing device store and keeps the defaults', async () => {
    const db = createMemoryDeviceDb()
    db.getSettings = () => Promise.reject(new Error('blocked'))
    const root = fakeRoot()
    const a = createAppearance(db, root.el)
    await expect(a.load()).resolves.toBeUndefined()
    expect([a.style.value, a.effectiveAccent.value]).toEqual(['base', 'indigo'])
    expect(root.attributes.get('data-style')).toBe('base')
  })

  it('a failing save rejects, and the choice stays applied', async () => {
    const db = createMemoryDeviceDb()
    db.putSettings = () => Promise.reject(new Error('quota'))
    const root = fakeRoot()
    const a = createAppearance(db, root.el)
    await expect(a.setStyle('y2k')).rejects.toThrow('quota')
    expect(root.attributes.get('data-style')).toBe('y2k')
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('main.css reads the style (plan 10 Task 1)', () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const known = new Set(MODES.flatMap((mode) => styleVars(neumorphism(mode, 'indigo')).map(([n]) => n)))

  it('no colour of its own: only the boot page colour before the style is applied', () => {
    const literals = code.split('\n').filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line) && !/--boot-page:/.test(line))
    expect(literals).toEqual([])
  })

  it('every --st-* variable it (or a component) reads is one the engine writes', () => {
    const app = fileURLToPath(new URL('../app/', import.meta.url))
    const sources = [code]
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.(vue|ts)$/.test(name) && !path.includes(`${join('lib', 'styles')}`)) sources.push(readFileSync(path, 'utf8'))
      }
    }
    for (const d of ['components', 'pages', 'layouts']) walk(join(app, d))
    const used = new Set(sources.flatMap((s) => [...s.matchAll(/--st-[\w-]+/g)].map((m) => m[0])))
    expect([...used].filter((n) => !known.has(n))).toEqual([])
  })

  it.each([
    ['.pressable', 'ghost'],
    ['.raised', 'btn'],
    ['.raised-sm', 'ib'],
    ['.add-tile', 'add'],
    ['.accent-button', 'primary'],
    ['.painted', 'painted'],
    ['.painted-destructive', 'painted-danger'],
    ['.pill-step', 'step'],
    ['.row-selected .pill-step', 'step-sel'],
  ])('%s reads the %s kind', (selector, kind) => {
    const body = ruleBody(code, selector)
    for (const s of ['h', 'p']) for (const p of ['bg', 'img', 'sh', 'fg', 'tf']) expect(body, `${s}-${p}`).toContain(`--${s}-${p}: var(--st-${kind}-${s}-${p})`)
  })

  it.each([
    ['.glass', ['--st-pop)', '--st-pop-sh', '--st-pop-r', '--st-pop-blur', '--st-pop-fg', '--st-pop-border', '--st-pop-muted', '--st-pop-danger']],
    ['.row-inset', ['--st-cur-m']],
    ['.row-selected', ['--st-cur-r', '--st-cur-fg', '--st-cur-muted']],
    ['.row-selected::after', ['--st-cur)', '--st-cur-sh']],
    ['.raised-card', ['--st-card)', '--st-card-sh', '--st-card-r', '--st-card-fg', '--st-card-muted', '--st-surf-blur']],
    ['.surface-list', ['--st-list)', '--st-list-sh', '--st-list-r', '--st-surf-blur']],
    ['.surface-header', ['--st-hdr)', '--st-hdr-sh', '--st-hdr-line', '--st-hdr-blur']],
    ['.surface-sheet', ['--st-sheet)', '--st-sheet-sh', '--st-sheet-line', '--st-sheet-blur']],
    ['.pill', ['--st-pill-bg', '--st-pill-img', '--st-pill-sh', '--st-pill-r', '--st-ctrl-blur']],
    ['.section-label', ['--st-label-font', '--st-label-weight', '--st-label-track', '--st-label-case']],
    ['.screen-title', ['--st-head-font', '--st-head-weight', '--st-head-track', '--st-head-case']],
    ['.tag-chip', ['--st-chips-0', '--st-chip-fgs-0', '--st-chip-sh', '--st-chip-r', '--st-chip-font']],
    ['.surface-bar', ['--st-hdr)', '--st-hdr-line', '--st-bar-sh', '--st-hdr-blur']],
    ['.amount', ['--st-num-weight']],
    ['.btn-text', ['--st-plain-btn-weight']],
    ['.btn-label', ['--st-btn-weight']],
  ] as const)('%s reads its tokens', (selector, names) => {
    const body = ruleBody(code, selector)
    for (const name of names) expect(body, name).toContain(name)
  })

  it('the body: the page, the font; the radius scale is the style\'s', () => {
    expect(code).toMatch(/body \{[^}]*background: var\(--st-page,/)
    expect(code).toMatch(/body \{[^}]*font-family: var\(--st-font,/)
    expect(code).toMatch(/--radius-field: min\(var\(--st-btn-r\), 26px\)/)
    for (const [radius, token] of [['card', 'card-r'], ['chip', 'small-r'], ['fab', 'prim-r']]) {
      expect(code).toMatch(new RegExp(`--radius-${radius}: var\\(--st-${token}\\)`))
    }
    expect(code).toMatch(/\.lucide\[stroke-width='2'\] \{\s*stroke-width: var\(--st-stroke\)/)
  })

  it('the high-contrast fallback makes every blurred panel opaque (popBlur, surfBlur, hdrBlur, ctrlBlur)', () => {
    const block = /@media \(prefers-contrast: more\) \{([\s\S]*?)\n {2}\}\n/.exec(code)?.[1] ?? ''
    for (const [selector, solid] of [['.glass', 'pop-solid'], ['.surface-bar', 'hdr-solid'], ['.raised-card', 'card-solid'], ['.surface-list', 'list-solid'], ['.surface-sheet', 'sheet-solid'], ['.photo-cover', 'photo-solid']]) {
      expect(block).toMatch(new RegExp(`\\${selector} \\{\\s*background: var\\(--st-${solid}\\)`))
    }
    expect(block).toMatch(/\.surface-header,\s*\.surface-bar \{/)
    for (const selector of ['.glass', '.surface-header', '.surface-bar', '.raised-card', '.surface-list', '.surface-sheet', '.photo-thumb', '.raised', '.raised-sm', '.add-tile', '.accent-button', '.pill']) {
      expect(block).toMatch(new RegExp(`\\${selector}[,\\s]`))
    }
    expect(block).toMatch(/(^|[^-])backdrop-filter: none/)
  })
})

describe('Neumorphism\'s dark accent and accent text (as before styles)', () => {
  it.each(ACCENT_NAMES)('%s: the dark accent is the light one lifted by 12 % white, accent text half-way to white', (accent) => {
    const t = neumorphism('dark', accent)
    expect(parseColor(t.accent)).toEqual(parseColor(mixHex(ACCENTS[accent].light, '#FFFFFF', 0.12)))
    expect(parseColor(t.ink)).toEqual(parseColor(mixHex(ACCENTS[accent].light, '#FFFFFF', 0.5)))
    // The painted accent button keeps the accent itself: the lift takes white text under 4.5:1.
    expect(parseColor(t.kinds.primary.n.bg)).toEqual(parseColor(ACCENTS[accent].light))
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('the appearance plugin (Review Focus 2)', () => {
  type Plugin = { name: string; parallel?: boolean; setup: () => Promise<{ provide: { appearance: unknown } }> }
  let plugin: Plugin
  beforeAll(async () => {
    // Nuxt's auto-import, as a global for the plugin module.
    vi.stubGlobal('defineNuxtPlugin', (p: Plugin) => p)
    plugin = (await import('../app/plugins/appearance.client')).default as unknown as Plugin
  })

  it('the stored style and accent are on <html> when its setup resolves: Nuxt mounts the app only after that', async () => {
    const db = createMemoryDeviceDb()
    await db.putSettings({ style: 'retro', accent: 'rose' })
    pluginDb.current = db
    const root = fakeRoot()
    vi.stubGlobal('document', { documentElement: root.el })
    try {
      const pending = plugin.setup()
      // Nothing is drawn before the stored style is known (no flash of the default style).
      expect(root.head).toHaveLength(0)
      const { provide } = await pending
      expect(root.attributes.get('data-style')).toBe('retro')
      expect(root.head.map((e) => e.id)).toEqual([STYLE_ELEMENT_ID])
      expect(root.head[0]!.textContent).toBe(styleCss('retro', 'teal'))
      expect((provide.appearance as { style: { value: string } }).style.value).toBe('retro')
    } finally {
      vi.unstubAllGlobals()
      vi.stubGlobal('defineNuxtPlugin', (p: Plugin) => p)
    }
  })

  it('is a client plugin Nuxt awaits before mounting: named, setup async, not deferred', () => {
    expect(plugin.name).toBe('appearance')
    const source = readFileSync(fileURLToPath(new URL('../app/plugins/appearance.client.ts', import.meta.url)), 'utf8')
    expect(source).toMatch(/await appearance\.load\(\)/)
    expect(source).not.toMatch(/dependsOn|enforce:\s*'post'|hooks:/)
  })
})

// ---------------------------------------------------------------------------------------------------------------------
// Fix round 1 (task 1 review).

describe('weights are the style\'s, sizes the markup\'s (spec §3)', () => {
  const app = fileURLToPath(new URL('../app/', import.meta.url))
  const WEIGHT = /(^|[\s'"`:])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?=$|[\s'"`])/
  function* vue(dir: string): Generator<{ name: string; source: string }> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) yield* vue(path)
      else if (name.endsWith('.vue')) yield { name: path.slice(app.length), source: readFileSync(path, 'utf8') }
    }
  }
  const files = ['components', 'pages', 'layouts'].flatMap((d) => [...vue(join(app, d))])
  /** Every class string literal of a file (attributes and script constants). */
  const classStrings = (source: string) => [...source.matchAll(/class="([^"]*)"|(['`])([^'`\n]*)\2/g)].map((m) => m[1] ?? m[3]!)

  it('a hooked amount or button label carries no weight utility of its own (the utility would beat the style)', () => {
    const problems = files.flatMap((f) =>
      classStrings(f.source)
        .filter((c) => /(^|\s)(amount|btn-label|btn-text)(\s|$)/.test(c) && WEIGHT.test(c))
        .map((c) => `${f.name}: ${c}`),
    )
    expect(problems).toEqual([])
  })

  it('every Button\'s label weight comes from the style: btn-text in its base, btn-label on the emphasised actions', () => {
    const variants = readFileSync(join(app, 'components/ui/button/index.ts'), 'utf8')
    const base = /cva\(\s*"([^"]*)"/.exec(variants)?.[1] ?? ''
    expect(base).toMatch(/(^|\s)btn-text(\s|$)/)
    expect(base).not.toMatch(WEIGHT)
    const problems = files.flatMap((f) =>
      [...f.source.matchAll(/<Button\b[^>]*>/g)].filter((m) => /class="[^"]*\bfont-(medium|bold)\b/.test(m[0])).map((m) => `${f.name}: ${m[0].slice(0, 80)}`),
    )
    expect(problems).toEqual([])
    const labelled = files.filter((f) => /\bbtn-label\b/.test(f.source)).map((f) => f.name)
    for (const name of ['components/ItemScreen.vue', 'components/ItemAttributes.vue', 'components/ItemActions.vue', 'components/FolderActions.vue', 'components/PhotoPicker.vue']) {
      expect(labelled).toContain(name)
    }
  })

  it('the amounts the mock-up draws at numWeight: stock total, stepper count, list and history amounts', () => {
    for (const name of ['components/StockCard.vue', 'components/StepperPill.vue', 'components/ItemList.vue', 'components/JournalList.vue']) {
      expect(readFileSync(join(app, name), 'utf8'), name).toMatch(/['"`\s]amount\s/)
    }
  })
})

describe('applying a style: a long realistic run (Review Focus 1)', () => {
  it('lists of different lengths: other <head> nodes untouched, no variable or value of an earlier style left', () => {
    const root = fakeRoot([
      { tagName: 'link' },
      { tagName: 'style', id: 'nuxt-fonts', textContent: '@font-face{font-family:Manrope}' },
    ])
    const others = root.head.slice()
    const saved = { brutal: STYLES.brutal.build, retro: STYLES.retro.build }
    // Shapes like the mock-up's: Brutal four chips, three thumbnails, a dotted page, a mark and the LED; Retro three.
    STYLES.brutal.build = (mode) => ({
      ...neumorphism(mode, 'blue'),
      page: 'radial-gradient(rgba(17,17,17,0.14) 1.2px, transparent 1.6px) 0 0 / 22px 22px, #FFF4DC',
      chips: ['#5B8CFF', '#3DDCAA', '#FF8C42', '#B08CFF'],
      chipFgs: ['#111111'],
      thumbs: ['#3DDCAA', '#FF8C42', '#FF7AB6'],
      mark: '✦ ',
      led: true,
    })
    STYLES.retro.build = (mode) => ({ ...neumorphism(mode, 'teal'), chips: ['#E9C46A', '#9FD3C7', '#F4A58A'], thumbs: ['#E9C46A', '#E76F51', '#2A9D8F'] })
    try {
      const run: [StyleName, AccentName][] = [
        ['base', 'indigo'],
        ['brutal', 'blue'],
        ['retro', 'teal'],
        ['neumorphism', 'rose'],
        ['base', 'teal'],
      ]
      const texts = run.map(([name, accent]) => {
        applyStyle(root.el, name, accent)
        const mine = root.head.filter((e) => e.id === STYLE_ELEMENT_ID)
        expect(mine, name).toHaveLength(1)
        // The other nodes of <head> are the same objects, in the same order.
        expect(root.head.filter((e) => e.id !== STYLE_ELEMENT_ID)).toEqual(others)
        expect(root.head.filter((e) => e.id !== STYLE_ELEMENT_ID).every((e, i) => e === others[i])).toBe(true)
        expect(root.attributes.get('data-style')).toBe(name)
        return mine[0]!.textContent
      })
      // Brutal had them…
      expect(texts[1]).toMatch(/--st-chips-3:#B08CFF/)
      expect(texts[1]).toMatch(/--st-thumbs-2:#FF7AB6/)
      expect(texts[1]).toContain('#FFF4DC')
      expect(texts[1]).toContain('--st-mark:"✦ "')
      expect(texts[1]).toContain('--st-led:1')
      // …and after Brutal → Retro none of it is left: its fourth chip, its page, its mark, its LED.
      expect(texts[2]).not.toMatch(/--st-chips-3:/)
      expect(texts[2]).not.toContain('#FFF4DC')
      expect(texts[2]).not.toContain('--st-mark:"✦ "')
      expect(texts[2]).not.toContain('--st-led:1')
      expect(texts[2]).toMatch(/--st-chips-2:#F4A58A/)
      // After Retro → Neumorphism: Retro's second and third chips and thumbnails are gone.
      expect(texts[3]).not.toMatch(/--st-(chips|thumbs)-[12]:/)
      expect(texts[4]).toBe(styleCss('base', 'teal'))
      expect([...root.attributes.keys()]).toEqual(['data-style'])
      expect(root.inline.size).toBe(0)
    } finally {
      STYLES.brutal.build = saved.brutal
      STYLES.retro.build = saved.retro
    }
  })
})

describe('a style that cannot be drawn', () => {
  it('falls back to the default style: the app still starts, the stored choice stays', async () => {
    const saved = STYLES.retro.build
    // A bad token (apply.ts refuses ; { } <), as a broken build of a newer app could have.
    STYLES.retro.build = (mode) => ({ ...neumorphism(mode, 'teal'), fg: 'red; color: blue' })
    try {
      const db = createMemoryDeviceDb()
      await db.putSettings({ style: 'retro' })
      const root = fakeRoot()
      const a = createAppearance(db, root.el)
      await expect(a.load()).resolves.toBeUndefined()
      expect(a.style.value).toBe('base')
      expect(root.attributes.get('data-style')).toBe('base')
      expect(root.head.filter((e) => e.id === STYLE_ELEMENT_ID).map((e) => e.textContent)).toEqual([styleCss('base', 'indigo')])
      expect((await db.getSettings()).style).toBe('retro')
      // Choosing it later does the same instead of leaving the page without a style.
      await a.setStyle('neumorphism')
      await a.setStyle('retro')
      expect(root.attributes.get('data-style')).toBe('base')
    } finally {
      STYLES.retro.build = saved
    }
  })
})

describe('derived: the bottom bar and plain button labels', () => {
  it('mirrorY turns a header\'s bottom line into a bar\'s top line', () => {
    expect(mirrorY('none')).toBe('none')
    expect(mirrorY('inset 0 -1px 0 #E4E7EC')).toBe('inset 0 1px 0 #E4E7EC')
    expect(mirrorY('inset 0 -1.5px 0 rgba(43,42,51,0.85)')).toBe('inset 0 1.5px 0 rgba(43,42,51,0.85)')
    expect(mirrorY('inset 0 -1px 0 rgba(255, 255, 255, 0.5), 0 1px 0 rgba(20,24,40,0.06)')).toBe('inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 -1px 0 rgba(20,24,40,0.06)')
  })
  it('barSh defaults to the header\'s shadow mirrored, plainBtnWeight to btnWeight', () => {
    const { barSh: _b, plainBtnWeight: _p, ...rest } = neumorphism('light', 'indigo')
    const t = deriveSurfaces({ ...rest, hdrSh: 'inset 0 -2px 0 #111111', btnWeight: '600' }, 'light')
    expect(t.barSh).toBe('inset 0 2px 0 #111111')
    expect(t.plainBtnWeight).toBe('600')
  })
})

describe('plan 12 tokens: out-of-stock dot, motion, num-font', () => {
  it('writes the status colour as a CSS variable, from the design system by default', () => {
    const vars = Object.fromEntries(styleVars(STYLES.base.build('light', 'indigo')))
    expect(vars['--st-status-out']).toBe('#B4BAC4')
    const dark = Object.fromEntries(styleVars(STYLES.base.build('dark', 'indigo')))
    expect(dark['--st-status-out']).toBe('#6B7280')
  })

  it('main.css exposes the semantic status colour, motion tokens and .num-font', () => {
    expect(css).toMatch(/--status-out:\s*var\(--st-status-out\)/)
    expect(css).toMatch(/--color-status-out:\s*var\(--status-out\)/)
    for (const v of ['--dur-fast', '--dur-base', '--dur-slow', '--ease-standard', '--ease-exit']) expect(css).toContain(`${v}:`)
    expect(css).toMatch(/\.num-font\s*\{\s*font-family:\s*var\(--st-num-font\);\s*\}/)
  })
})
