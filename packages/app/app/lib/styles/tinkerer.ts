import { mix, rgba } from './color'
import { accentOf, K, MOCKUP_DEFAULTS, S, finish } from './derive'
import { stack } from './fonts'
import type { StyleBuild } from './types'

/*
 * S9 Tinkerer («Технарь»): a bench instrument — IBM Plex, mono values and labels, the accent (copper by default) on
 * hairlines, corner ticks on cards, a status LED on the stock card (the owner's board S9). The mock-up's `tinkerer`
 * branch of build(), verbatim. The LED, its label and the out-of-stock state are drawn by
 * assets/css/styles/tinkerer.css; the ticks are layers of `card`.
 *
 * Where it differs from the mock-up: shades chosen so every text reads at 4.5:1 or better in every accent (spec §8;
 * each one, with its numbers, is in Plan 10 Task 6's report). Light theme only; dark is the mock-up's.
 *  - The brushed primary button: the paint is the accent 12 % deeper, its top light 0.06 instead of 0.2, hover lifts
 *    it 4 % (not 8 %) and press deepens it 12 % from there (warm white on blue or green under 20 % white read 3:1).
 *  - The "⋯" on a selected row when its menu is open: the accent at 12 % instead of 18 % (green 4.25:1).
 */

export const build: StyleBuild = (mode, accent) => {
  const { dark, A, ink } = accentOf(mode, accent)
  const plex = stack('IBM Plex Sans')
  const mono = stack('IBM Plex Mono', 'ui-monospace, monospace')
  const C = A
  const surf = dark ? '#171A1D' : '#F6F5F2'
  const hair = dark ? '#2A2F35' : '#CFCBC2'
  const ring = 'inset 0 0 0 1px ' + hair
  const hi = dark ? 'inset 0 1px 0 rgba(255,255,255,0.04)' : 'inset 0 1px 0 #FFFFFF'
  const fg = dark ? '#E8E6E1' : '#1A1C1E'
  const muted = dark ? '#9DA3AA' : '#5A5852'
  const icon = dark ? '#C9CDD2' : '#2E3134'
  const tick = (c: string) =>
    ['top left', 'top right', 'bottom left', 'bottom right']
      .map((p) => 'linear-gradient(' + c + ', ' + c + ') ' + p + ' / 12px 1.5px no-repeat, linear-gradient(' + c + ', ' + c + ') ' + p + ' / 1.5px 12px no-repeat')
      .join(', ')
  const line = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.035)'
  const grid = 'linear-gradient(' + line + ' 1px, transparent 1px) 0 0 / 24px 24px, linear-gradient(90deg, ' + line + ' 1px, transparent 1px) 0 0 / 24px 24px'
  const glow = '0 0 0 3px ' + rgba(C, dark ? 0.16 : 0.14)
  const pressed = dark ? '#121417' : '#E4E1DA'
  const pSh = 'inset 0 1px 2px rgba(0,0,0,' + (dark ? '0.5' : '0.18') + '), inset 0 0 0 1px ' + hair
  const hot = 'inset 0 0 0 1px ' + rgba(C, 0.7) + ', ' + glow
  const brushed = 'repeating-linear-gradient(90deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px), linear-gradient(180deg, rgba(255,255,255,' + (dark ? '0.2' : '0.06') + '), rgba(0,0,0,0.14))'
  /** The primary's paint: the accent; on light 12 % deeper, so the warm white label stays at 4.5:1. */
  const paint = dark ? C : mix(C, '#000000', 0.12)
  const priFg = dark ? '#1A0F08' : '#FFF7EF'
  /** Accent text: the accent itself on dark, 15 % deeper on light. */
  const cInk = dark ? C : mix(C, '#000000', 0.15)

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: plex,
      headFont: plex,
      headWeight: '600',
      headTrack: '-0.01em',
      labelFont: mono,
      labelSize: '11px',
      labelWeight: '500',
      labelCase: 'uppercase',
      labelTrack: '0.12em',
      mark: '// ',
      markColor: C,
      numFont: mono,
      numWeight: '500',
      chipFont: mono,
      btnWeight: '600',
      stroke: '1.5',
      cap: 'square',
      join: 'miter',
      page: grid + ', ' + (dark ? '#0F1113' : '#E9E7E2'),
      fg,
      muted,
      subtle: muted,
      icon,
      dimmed: muted,
      ink,
      hdr: dark ? '#0F1113' : '#E9E7E2',
      hdrSh: 'inset 0 -1px 0 ' + hair,
      photo: dark ? '#14171A' : '#DEDBD3',
      photoSh: ring,
      photoR: '4px',
      photoFg: muted,
      thumbs: [dark ? '#14171A' : '#DEDBD3'],
      thumbFg: muted,
      thumbSh: ring,
      thumbR: '2px',
      chips: ['transparent'],
      chipFgs: [dark ? '#C9CDD2' : '#3A3C3F'],
      chipSh: 'inset 0 0 0 1px ' + (dark ? '#3A4047' : '#BDB8AD'),
      chipR: '2px',
      card: tick(C) + ', linear-gradient(180deg, ' + (dark ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.5)') + ', rgba(255,255,255,0)), ' + surf,
      cardSh: ring + ', ' + hi,
      cardR: '3px',
      cardFg: fg,
      cardMuted: muted,
      list: surf,
      listSh: ring + ', ' + hi,
      listR: '3px',
      divider: '1px solid ' + (dark ? '#23272C' : '#DDD9D0'),
      cur: rgba(C, dark ? 0.1 : 0.08),
      curSh: 'inset 0 0 0 1px ' + rgba(C, 0.55),
      curR: '2px',
      curM: '0 6px',
      curFg: cInk,
      curMuted: muted,
      pillBg: surf,
      pillImg: 'none',
      pillSh: ring + ', ' + hi,
      pillR: '3px',
      seam: '1px solid ' + hair,
      ibR: '3px',
      btnR: '3px',
      primR: '3px',
      ghostR: '2px',
      popItemR: '2px',
      pop: surf,
      popSh: ring + ', 0 12px 32px ' + (dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'),
      popR: '3px',
      popFg: fg,
      popHover: rgba(C, dark ? 0.12 : 0.1),
      popHoverFg: cInk,
      popDanger: dark ? '#FF8E7A' : '#B42318',
      popDiv: hair,
      led: true,
      ledColor: dark ? '#3DDC84' : '#1F9D55',
      ledGlow: dark ? '0 0 6px rgba(61,220,132,0.9), 0 0 2px rgba(61,220,132,1)' : '0 0 4px rgba(31,157,85,0.6)',
      tr: 'background-color 90ms linear, box-shadow 90ms linear, color 90ms linear',
      kinds: {
        ib: K(S(surf, 0, ring + ', ' + hi, icon), S(surf, 0, hot, cInk), S(pressed, 0, pSh, cInk)),
        add: K(S(surf, 0, ring + ', ' + hi, icon), S(surf, 0, hot, cInk), S(pressed, 0, pSh, cInk)),
        btn: K(S(surf, 0, ring + ', ' + hi, fg), S(surf, 0, hot, cInk), S(pressed, 0, pSh, cInk)),
        primary: K(
          S(paint, brushed, 'inset 0 0 0 1px ' + mix(C, '#000000', 0.3) + ', inset 0 1px 0 rgba(255,255,255,0.25)', priFg),
          S(mix(paint, '#ffffff', dark ? 0.08 : 0.04), brushed, 'inset 0 0 0 1px ' + mix(C, '#000000', 0.3) + ', inset 0 1px 0 rgba(255,255,255,0.25), ' + glow, priFg),
          S(mix(paint, '#000000', 0.12), brushed, 'inset 0 2px 3px rgba(0,0,0,0.35), inset 0 0 0 1px ' + mix(C, '#000000', 0.35), priFg),
        ),
        step: K(S('rgba(0,0,0,0)', 0, 0, icon), S(rgba(C, 0.1), 0, 0, cInk), S(pressed, 0, 'inset 0 1px 2px rgba(0,0,0,0.25)', cInk)),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, muted), S(rgba(C, 0.1), 0, 0, cInk), S(rgba(C, 0.18), 0, 0, cInk)),
      },
      ghostSel: K(S('rgba(0,0,0,0)', 0, 0, muted), S(rgba(C, 0.1), 0, 0, cInk), S(rgba(C, dark ? 0.18 : 0.12), 0, 0, cInk)),
    },
    mode,
  )
}
