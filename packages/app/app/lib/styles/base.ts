import { mix, over, parseColor, rgba, type Rgba } from './color'
import { accentOf, K, MOCKUP_DEFAULTS, S, finish } from './derive'
import type { StyleBuild } from './types'

/*
 * S1 Base — flat + material: tonal fills, light elevation, state layers. The default style (the owner, 2026-11-12).
 * The mock-up's `base` branch of build() (styles-mockup.dc.html), verbatim, except:
 *
 * Shades picked for contrast (spec §8; each keeps the mock-up's amount wherever its text reads at 4.5:1; light indigo,
 * the default, is the mock-up's everywhere; on dark the lighter card of plan 12 leaves less room):
 *  - the primary button's hover lifts the accent 8 % toward white, or less: as far as its text stays at 4.5:1
 *    (green: 5 %; 8 % takes white text to 4.35:1);
 *  - dark: the tonal button's pressed tone is 28 %, or less: as far as the accent ink on it stays at 4.5:1 (green 28 %;
 *    blue, teal, orange 27 %; indigo, violet, sky 26 %; slate 25 %; copper 24 %; pink 23 %; rose 22 %);
 *  - dark: flat controls on the selected row ("⋯" open: accent ink) press to a 14 % state layer, or less, by the same
 *    rule (blue, green 14 %; teal, orange 13 %; indigo, violet, sky 12 %; slate 11 %; copper 10 %; pink 9 %; rose 8 %);
 *  - dark: icon buttons press to a 20 % state layer, or less, as far as the accent ink stays at 4.5:1 on a sheet (the
 *    raised layer): rose 19 %.
 *
 * Dark layers (plan 12, the design system's surface and raised): the page #111216, cards and lists a step lighter
 * (#1E2026, about 5 % OKLCH lightness up; the mock-up's #1A1C21 sat too close to the page) with a 6 % white rim, menus
 * and sheets a step above them (#23262C). Controls transition at the design system's dur-fast (100 ms ease-standard).
 *
 * App surfaces the mock-up does not draw (spec §5; derive.ts derives the rest):
 *  - sheets and dialogs: the card (light), the raised layer (dark);
 *  - fields and checkboxes keep the list's surface, with a line that reads on a sheet (the list's own frame is an
 *    elevation shadow; the divider colour vanishes on white);
 *  - generic lines (boxes, the tree panel's edge, toasts) are the header line's colour (light) and the seam's (dark):
 *    the row divider is too faint to outline a box.
 */

export const build: StyleBuild = (mode, accent) => {
  const { dark, A, onA, ink } = accentOf(mode, accent)
  const surf = dark ? '#1E2026' : '#FFFFFF'
  /** Dark: the raised layer of the design system (menus, sheets), a step above the card. */
  const raised = '#23262C'
  const e1 = dark ? 'inset 0 0 0 1px rgba(255,255,255,0.06)' : '0 1px 2px rgba(16,24,40,0.06), 0 1px 3px rgba(16,24,40,0.10)'
  const e2 = dark ? 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 2px 6px rgba(0,0,0,0.4)' : '0 2px 4px rgba(16,24,40,0.06), 0 4px 8px rgba(16,24,40,0.10)'
  const fg = dark ? '#ECEEF2' : '#16181D'
  const muted = dark ? '#A2A8B4' : '#5D6370'
  const icon = dark ? '#D0D4DC' : '#3A3F4A'
  /** A tone: the accent mixed into the surface. */
  const ton = (x: number) => mix(surf, A, x)
  const cur = ton(dark ? 0.16 : 0.1)

  const lift = upTo(0.08, (x) => [mix(A, '#ffffff', x)], onA)
  const pressTone = upTo(dark ? 0.28 : 0.22, (x) => [ton(x)], ink)
  const ghost = K(S('rgba(0,0,0,0)', 0, 0, muted), S(rgba(A, 0.08), 0, 0, ink), S(rgba(A, 0.14), 0, 0, ink))
  const selHover = upTo(0.08, (x) => [rgba(A, x), cur], ink)
  const selPress = upTo(0.14, (x) => [rgba(A, x), cur], ink)
  const ibPress = dark ? upTo(0.2, (x) => [rgba(A, x), raised], ink) : 0.14

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      page: dark ? '#111216' : '#F4F5F7',
      fg,
      muted,
      subtle: muted,
      icon,
      dimmed: dark ? '#BFC4CE' : '#4A4F5A',
      ink,
      hdr: surf,
      hdrSh: dark ? 'inset 0 -1px 0 #262930' : 'inset 0 -1px 0 #E4E7EC',
      photo: dark ? '#22252B' : '#E9ECF0',
      photoSh: 'none',
      photoR: '16px',
      photoFg: muted,
      thumbs: [dark ? '#22252B' : '#E9ECF0'],
      thumbFg: muted,
      thumbSh: 'none',
      thumbR: '12px',
      chips: [dark ? '#262930' : '#ECEEF2'],
      chipFgs: [fg],
      chipSh: 'none',
      chipR: '8px',
      card: surf,
      cardSh: e1,
      cardR: '16px',
      cardFg: fg,
      cardMuted: muted,
      list: surf,
      listSh: e1,
      listR: '16px',
      divider: '1px solid ' + (dark ? '#262930' : '#EEF0F3'),
      cur,
      curSh: 'none',
      curR: '10px',
      curM: '0 6px',
      curFg: ink,
      curMuted: muted,
      pillBg: dark ? '#23262C' : '#F0F2F5',
      pillImg: 'none',
      pillSh: 'none',
      pillR: '12px',
      seam: '1px solid ' + (dark ? '#2E3138' : '#E2E5EA'),
      ibR: '12px',
      btnR: '12px',
      primR: '12px',
      pop: dark ? raised : '#FFFFFF',
      popSh: dark ? '0 8px 24px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)' : '0 8px 24px rgba(16,24,40,0.16), 0 2px 6px rgba(16,24,40,0.08)',
      popR: '12px',
      popFg: fg,
      popHover: rgba(A, dark ? 0.12 : 0.08),
      popHoverFg: ink,
      popDanger: dark ? '#FCA5A5' : '#B42318',
      popDiv: dark ? '#2E3138' : '#EEF0F3',
      // The design system's dur-fast and ease-standard (main.css --dur-fast, --ease-standard).
      tr: 'background-color 100ms cubic-bezier(0.2,0,0,1), box-shadow 100ms cubic-bezier(0.2,0,0,1), color 100ms cubic-bezier(0.2,0,0,1)',
      kinds: {
        ib: K(S('rgba(0,0,0,0)', 0, 0, icon), S(rgba(A, dark ? 0.12 : 0.08), 0, 0, ink), S(rgba(A, ibPress), 0, 0, ink)),
        add: K(S(surf, 0, e1, icon), S(ton(0.06), 0, e2, ink), S(ton(0.12), 0, 'none', ink)),
        btn: K(S(ton(dark ? 0.16 : 0.1), 0, 'none', ink), S(ton(dark ? 0.22 : 0.16), 0, e1, ink), S(ton(pressTone), 0, 'none', ink)),
        primary: K(S(A, 0, 'none', onA), S(mix(A, '#ffffff', lift), 0, e2, onA), S(mix(A, '#000000', 0.08), 0, 'none', onA)),
        step: K(S('rgba(0,0,0,0)', 0, 0, icon), S(rgba(A, 0.1), 0, 0, ink), S(rgba(A, 0.18), 0, 0, ink)),
        ghost,
      },
      ghostSel: K({ ...ghost.n, fg: muted }, { ...ghost.h, bg: rgba(A, selHover) }, { ...ghost.p, bg: rgba(A, selPress) }),

      // Dark: sheets and dialogs are the raised layer, like menus (the card is a step below them, the page two).
      sheet: dark ? raised : surf,
      fieldLine: dark ? '#3A3E47' : '#D0D5DD',
      border: dark ? '#2E3138' : '#E4E7EC',
    },
    mode,
  )
}

// ---------------------------------------------------------------------------------------------------------------------
// Contrast (also used by Linear): the shade the mock-up asks for, or the nearest one its text still reads on.

function luminance(c: Rgba): number {
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

/** WCAG 2 contrast of `text` on a stack of backgrounds, top first (a translucent layer is drawn over the next one, the
 *  last over white). */
export function contrastOn(text: string, backgrounds: string[]): number {
  const color = (s: string) => parseColor(s) ?? { r: 0, g: 0, b: 0, a: 0 }
  const back = backgrounds.reduceRight<Rgba>((under, layer) => over(color(layer), under), { r: 255, g: 255, b: 255, a: 1 })
  const [hi, lo] = [luminance(over(color(text), back)), luminance(back)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** The mock-up's amount `k`, or the largest smaller one (in 1 % steps) at which `text` reads at 4.5:1 on the
 *  backgrounds `at(amount)` (top first). */
export function upTo(k: number, at: (x: number) => string[], text: string): number {
  for (let x = Math.round(k * 100); x > 0; x--) if (contrastOn(text, at(x / 100)) >= 4.5) return x / 100
  return 0
}
