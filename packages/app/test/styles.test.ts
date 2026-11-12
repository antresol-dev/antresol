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
        ['accent-button', t.kinds.primary.n.bg], ['accent-button-hover', t.kinds.primary.h.bg], ['accent-button-pressed', t.kinds.primary.p.bg],
        ['accent-button-foreground', t.kinds.primary.n.fg], ['accent-button-foreground', t.kinds.primary.h.fg],
        ['accent-button-foreground', t.kinds.primary.p.fg], ['glass-hover', t.popHover], ['glass-hover-foreground', t.popHoverFg],
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
        ['accent-button-shadow', t.kinds.primary.n.sh], ['accent-button-shadow-hover', t.kinds.primary.h.sh],
        ['accent-button-shadow-pressed', t.kinds.primary.p.sh], ['glass-shadow', t.popSh],
        ['hover-shadow', t.painted.n.sh, pv.accent], ['hover-shadow', t.painted.h.sh, pv.accent], ['active-shadow', t.painted.p.sh, pv.accent],
        ['hover-shadow', t.paintedDanger.n.sh, pv.destructive], ['hover-shadow', t.paintedDanger.h.sh, pv.destructive],
        ['active-shadow', t.paintedDanger.p.sh, pv.destructive],
      ]
      const problems = pairs.flatMap(([name, value, vars]) => {
        const p = shadowProblem(shadows(value), shadows(`var(--${name})`, vars ?? v))
        return p ? [`--${name}: ${p}`] : []
      })
      // Flat things had no shadow; sheets had Tailwind's shadow-lg (DialogContent), the ghost none.
      for (const [name, value] of [['hdrSh', t.hdrSh], ['listSh', t.listSh], ['photoSh', t.photoSh], ['thumbSh', t.thumbSh], ['chipSh', t.chipSh], ['curSh', t.curSh], ['fieldSh', t.fieldSh], ['tipSh', t.tipSh]]) {
        if (value !== 'none') problems.push(`${name} ${value}`)
      }
      for (const s of ['n', 'h', 'p'] as const) if (t.kinds.ghost[s].sh !== 'none') problems.push(`ghost.${s}.sh`)
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
      expect(t.kinds.primary.p.tf).toBe(pressTf(scale('.accent-button')))
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
      expect([t.list, t.listR, t.curM, t.pillImg, t.hdr]).toEqual(['transparent', '0', '0', 'none', t.pageColor])
      expect(t.overlay).toBe('rgba(0, 0, 0, 0.8)')
    })
  })
})

// ---------------------------------------------------------------------------------------------------------------------

describe('applying a style (Review Focus 1)', () => {
  it('one <style id="gm-style"> with both themes, data-style on <html>, nothing of the previous style left', () => {
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
function contrastProblems(t: StyleTokens, neumorphismGhostSel = false, stateInk: StateInk = { h: false, p: false }): string[] {
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
  for (const [name, surface] of [['page', page], ['card', card], ['list', list], ['pop', pop]] as const) {
    // A card with text of its own (Neo-brutal's Memphis cards: ink in both themes, where its dark page text is light)
    // gives everything in it that text in the style's CSS (brutal.css); cardFg and cardMuted are checked below.
    if (name === 'card' && t.cardFg !== t.fg) continue
    for (const text of ['fg', 'muted', 'icon'] as const) check(`${text} on ${name}`, t[text], surface)
  }
  check('subtle on page', t.subtle, page)
  check('dimmed on page', t.dimmed, page)
  check('ink on page', t.ink, page)
  check('ink on list', t.ink, list)
  check('destructive on page', t.destructive, page)
  check('warning on page', t.warning, page)
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
  // Controls: the text of each state on its fill (and image), over what the control sits on.
  const pill = on(t.pillBg, page)
  const pillSel = on(t.pillSelBg, cur)
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
  const path = fileURLToPath(new URL(`../app/assets/css/styles/${name}.css`, import.meta.url))
  const code = existsSync(path) ? readFileSync(path, 'utf8') : ''
  return { h: code.includes('--accent-ink: var(--h-fg)'), p: code.includes('--accent-ink: var(--p-fg)') }
}

describe.each(STYLE_NAMES)('contrast: %s', (name) => {
  const info = STYLES[name]
  const stateInk = stateInkOf(name)
  const accents: AccentName[] = info.fixedPalette ? [info.defaultAccent] : ACCENT_NAMES
  it.each(MODES.flatMap((mode) => accents.map((accent) => [mode, accent] as const)))('%s, %s: every text on its background at 4.5:1 or better', (mode, accent) => {
    const t = info.build(mode, accent)
    // Neumorphism's own tokens (itself, or a stub that still draws it) carry the one known exception.
    const own = name === 'neumorphism' || JSON.stringify(t) === JSON.stringify(neumorphism(mode, effectiveAccent(name, accent)))
    expect(contrastProblems(t, own, stateInk)).toEqual([])
  })
})

describe('the contrast gate', () => {
  it('a style other than Neumorphism is held to its selected row\'s "⋯" too', () => {
    const t = neumorphism('light', 'blue')
    expect(contrastProblems(t, true)).toEqual([])
    expect(contrastProblems(t).some((p) => p.startsWith('ghostSel.p.fg') || p.startsWith('ink on ghostSel'))).toBe(true)
  })
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
    ['.row-selected', ['--st-cur-r', '--st-cur-fg', '--st-cur-muted']],
    ['.row-selected::after', ['--st-cur)', '--st-cur-sh', '--st-cur-m']],
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
