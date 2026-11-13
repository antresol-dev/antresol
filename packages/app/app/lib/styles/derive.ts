import { ACCENTS, type AccentName } from '../accent'
import { borderColor, mix, solidOf, topLevel } from './color'
import { stack } from './fonts'
import type { AppSurfaces, Kind, KindState, Mode, MockupTokens, StyleSource, StyleTokens, ThumbTones } from './types'

/*
 * What every style module builds with: the mock-up's helpers (its build() prelude, S, K, `base` defaults, glass(),
 * corners()), finish() — the mock-up's shared fallbacks at the end of build() — and deriveSurfaces(), the one place
 * where the app's own surfaces are derived from the mock-up's keys (spec §5).
 */

/** The mock-up's font stacks (fontLink). */
export const FONT = {
  onest: stack('Onest'),
  manrope: stack('Manrope'),
  inter: stack('Inter'),
} as const

/** The mock-up's prelude of build(): the accent's light (AL) and dark (AD) values, the mode's accent (A), text on it
 *  (onA) and accent-coloured text (ink). */
export function accentOf(mode: Mode, accent: AccentName): { dark: boolean; AL: string; AD: string; A: string; onA: string; ink: string } {
  const dark = mode === 'dark'
  const AL = ACCENTS[accent].light
  const AD = ACCENTS[accent].dark
  return { dark, AL, AD, A: dark ? AD : AL, onA: dark ? '#16181D' : '#FFFFFF', ink: dark ? AD : mix(AL, '#000000', 0.18) }
}

/** The design system's six thumbnail tones (thumb-1…6 and thumb-N-foreground), light then dark. */
export const THUMB_TONES: Record<Mode, ThumbTones> = {
  light: [
    { bg: '#E5EAF5', fg: '#34466F' },
    { bg: '#F3ECE0', fg: '#6B5328' },
    { bg: '#E3EEE7', fg: '#2F5A41' },
    { bg: '#F3E6EA', fg: '#6E3346' },
    { bg: '#ECE8F5', fg: '#4E3F78' },
    { bg: '#E1EEEF', fg: '#28585C' },
  ],
  dark: [
    { bg: '#273041', fg: '#AFC0E3' },
    { bg: '#3A3328', fg: '#E3CFA6' },
    { bg: '#24342B', fg: '#A9D3B9' },
    { bg: '#3A2830', fg: '#E6B3C4' },
    { bg: '#312C40', fg: '#C8BCEB' },
    { bg: '#223638', fg: '#A4D2D4' },
  ],
}

/** The mock-up's S(bg, img, sh, fg, tf): a control state; a falsy img, sh or tf is 'none'. */
export function S(bg: string, img: string | 0 | undefined, sh: string | 0 | undefined, fg: string, tf?: string): KindState {
  return { bg, img: img || 'none', sh: sh || 'none', fg, tf: tf || 'none' }
}

/** The mock-up's K(n, h, p). */
export function K(n: KindState, h: KindState, p: KindState): Kind {
  return { n, h, p }
}

/** The mock-up's `base`: the defaults every style starts from (the Base style's light values for type and blur). */
export const MOCKUP_DEFAULTS = {
  font: FONT.onest,
  headFont: FONT.onest,
  headSize: '24px',
  headWeight: '700',
  headTrack: '-0.02em',
  headCase: 'none',
  labelFont: FONT.onest,
  labelSize: '13px',
  labelWeight: '600',
  labelCase: 'none',
  labelTrack: '0',
  mark: '',
  markColor: 'inherit',
  numFont: 'inherit',
  numWeight: '700',
  chipFont: 'inherit',
  btnWeight: '700',
  stroke: '2',
  cap: 'round',
  join: 'round',
  winBg: 'transparent',
  winBlur: 'none',
  hdrBlur: 'none',
  surfBlur: 'none',
  ctrlBlur: 'none',
  popBlur: 'none',
  led: false,
  ledColor: 'transparent',
  ledGlow: 'none',
  seam: '1px solid transparent',
  ghostR: '10px',
  popItemR: '10px',
} satisfies Partial<MockupTokens>

/** The mock-up's glass(dark): the liquid-glass menu of the Neumorphism and Liquid styles. */
export function glass(dark: boolean): Pick<MockupTokens, 'pop' | 'popBlur' | 'popSh' | 'popR' | 'popFg' | 'popHover' | 'popDanger' | 'popDiv' | 'popItemR'> {
  return dark
    ? {
        pop: 'linear-gradient(165deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.03) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.05) 100%), rgba(44,48,58,0.48)',
        popBlur: 'blur(16px) saturate(160%)',
        popSh: '0 20px 44px -12px rgba(0,0,0,0.6), 0 4px 12px -4px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 1px rgba(255,255,255,0.04), inset 0 0 0 1px rgba(255,255,255,0.12)',
        popR: '20px',
        popFg: '#E6E8EE',
        popHover: 'rgba(255,255,255,0.1)',
        popDanger: '#FCA5A5',
        popDiv: 'rgba(255,255,255,0.08)',
        popItemR: '14px',
      }
    : {
        pop: 'linear-gradient(165deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.12) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.18) 100%), rgba(255,255,255,0.38)',
        popBlur: 'blur(14px) saturate(180%)',
        popSh: '0 18px 40px -14px rgba(28,32,48,0.35), 0 4px 12px -4px rgba(28,32,48,0.14), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 1px rgba(255,255,255,0.3), inset 0 0 0 1px rgba(255,255,255,0.65)',
        popR: '20px',
        popFg: '#1C2030',
        popHover: 'rgba(255,255,255,0.55)',
        popDanger: '#B91C1C',
        popDiv: 'rgba(28,32,48,0.1)',
        popItemR: '14px',
      }
}

/** The mock-up's corners(r, left): each half of the −/+ pill keeps only the pill's outer corners. */
export function corners(r: string, left: boolean): string {
  return left ? r + ' 0 0 ' + r : '0 ' + r + ' ' + r + ' 0'
}

/** The mock-up's shared fallbacks (end of build()), then deriveSurfaces: a complete StyleTokens. */
export function finish(source: StyleSource, mode: Mode): StyleTokens {
  const k: MockupTokens & Partial<AppSurfaces> = {
    ...source,
    pillSelBg: source.pillSelBg ?? source.pillBg,
    pillSelSh: source.pillSelSh ?? source.pillSh,
    stepSel: source.stepSel ?? source.kinds.step,
    // Flat controls in the selected row show its muted colour (the row sets --muted-foreground to curMuted).
    ghostSel: source.ghostSel ?? { ...source.kinds.ghost, n: { ...source.kinds.ghost.n, fg: source.curMuted } },
    pillRL: corners(source.pillR, true),
    pillRR: corners(source.pillR, false),
  }
  return deriveSurfaces(k, mode)
}

/** A shadow list turned upside down: every shadow's vertical offset negated (a header's bottom line becomes a bar's
 *  top line). */
export function mirrorY(shadow: string): string {
  if (shadow.trim() === 'none') return 'none'
  return topLevel(shadow)
    .map((one) => {
      let n = 0
      // The second length of a shadow is its vertical offset; colours are inside () or #hex, never a bare length.
      return one.replace(/(^|\s)(-?[\d.]+)(px)?(?=\s|$)/g, (m, space: string, num: string, px = '') =>
        ++n === 2 ? `${space}${num.startsWith('-') ? num.slice(1) : num === '0' ? num : '-' + num}${px}` : m,
      )
    })
    .join(', ')
}

/** The colour of the first `inset 0 0 0 Npx <colour>` ring in a shadow list, if any. */
function ringColor(shadow: string): string | null {
  const m = /inset\s+0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+[\d.]+px\s+(#[0-9a-fA-F]{3,8}|rgba?\([^()]*\))/.exec(shadow)
  return m ? m[1]! : null
}

/**
 * The app's surfaces from the mock-up's keys (spec §5): sheet and dialog = card; field = the list's surface with its
 * ring; menus and tooltips = pop; the selected row = cur (main.css); buttons by role (main.css). A key the style
 * already set is kept. Every default is listed on its key in types.ts (AppSurfaces).
 */
export function deriveSurfaces(k: MockupTokens & Partial<AppSurfaces>, mode: Mode): StyleTokens {
  const dark = mode === 'dark'
  const pageColor = k.pageColor ?? solidOf(`${k.winBg}, ${k.page}`)
  const opaque = (bg: string) => solidOf(bg, pageColor)
  const accent = k.accent ?? opaque(k.kinds.primary.n.bg)
  const surface = k.surface ?? opaque(k.card)
  const dividerColor = k.dividerColor ?? borderColor(k.divider)
  const border = k.border ?? dividerColor
  // Dark: a sheet or the drawer is the page's colour or near it, over a scrim of 80 % black: without a rim its edge
  // vanishes (1.1–1.5:1). A light rim, 16 % white. Light themes need none.
  const sheetLine = k.sheetLine ?? (dark ? 'rgba(255,255,255,0.16)' : 'transparent')
  const destructive = k.destructive ?? k.popDanger
  const destructiveFg = k.destructiveFg ?? (dark ? '#16181D' : '#FFFFFF')
  const paint = opaque(destructive)
  const popSolid = k.popSolid ?? opaque(k.pop)
  const derived: AppSurfaces = {
    pageColor,
    accent,
    accentSoft: k.accentSoft ?? mix(surface, opaque(accent), dark ? 0.16 : 0.12),
    accentSoftFg: k.accentSoftFg ?? k.ink,
    primary: k.primary ?? accent,
    primaryFg: k.primaryFg ?? k.kinds.primary.n.fg,
    ring: k.ring ?? k.ink,
    painted: k.painted ?? k.kinds.primary,
    paintedDanger:
      k.paintedDanger ??
      K(
        S(destructive, 0, 0, destructiveFg),
        S(mix(paint, '#000000', 0.08), 0, 0, destructiveFg),
        S(mix(paint, '#000000', 0.12), 0, 0, destructiveFg, k.kinds.primary.p.tf),
      ),
    destructive,
    destructiveFg,
    warning: k.warning ?? (dark ? '#FBBF24' : '#92400E'),
    rowHover: k.rowHover ?? k.kinds.ghost.h.bg,
    chip: k.chip ?? k.chips[0]!,
    thumb: k.thumb ?? k.thumbs[0]!,
    thumbTones: k.thumbTones ?? THUMB_TONES[mode],
    statusOut: k.statusOut ?? (dark ? '#6B7280' : '#B4BAC4'),
    surface,
    rail: k.rail ? opaque(k.rail) : pageColor,
    railLine: k.railLine ?? '1px solid ' + border,
    border,
    dividerColor,
    treeLine: k.treeLine ?? border,
    hdrLine: k.hdrLine ?? 'transparent',
    field: k.field ?? opaque(k.list),
    fieldLine: k.fieldLine ?? ringColor(k.listSh) ?? border,
    fieldSh: k.fieldSh ?? 'none',
    sheet: k.sheet ?? k.card,
    sheetSh: k.sheetSh ?? k.cardSh,
    sheetLine,
    sheetBlur: k.sheetBlur ?? k.surfBlur,
    paletteImg: k.paletteImg ?? 'none',
    paletteSh: k.paletteSh ?? '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    paletteLine: k.paletteLine ?? sheetLine,
    overlay: k.overlay ?? 'rgba(0,0,0,0.8)',
    popSolid,
    popBorder: k.popBorder ?? 'transparent',
    popMuted: k.popMuted ?? k.muted,
    tip: k.tip ?? popSolid,
    tipFg: k.tipFg ?? k.popFg,
    tipSh: k.tipSh ?? k.popSh,
    smallR: k.smallR ?? k.ghostR,
    plainBtnWeight: k.plainBtnWeight ?? k.btnWeight,
    barSh: k.barSh ?? mirrorY(k.hdrSh),
  }
  return { ...k, ...derived }
}
