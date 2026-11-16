import { mix, rgba, rot, solidOf } from './color'
import { K, MOCKUP_DEFAULTS, S, accentOf, finish, glass } from './derive'
import { stack } from './fonts'
import type { StyleBuild } from './types'

/*
 * S4 Liquid glass — macOS 26: a vivid wallpaper, glass everywhere, capsules, specular rims, a springy press. The
 * mock-up's `liquid` branch of build(), verbatim, with the mock-up's glass() menus. Its own CSS:
 * assets/css/styles/liquid.css (controls inside a blurred panel do not blur again; radii of blocks that are not
 * controls).
 *
 * What the app adds (spec §5), each for a case the mock-up's screen does not have:
 *  - sheets and dialogs are the card made opaque, keeping its sheen and rim: they sit over the scrim, where translucent
 *    glass turns grey (and on the phone the search palette fills the screen); no blur behind an opaque pane;
 *  - fields wear the control glass (the stepper's, the chips') with its top highlight and the divider's hairline: on an
 *    opaque sheet the list's own glass would be the sheet's colour, and its white rim would vanish.
 *
 * Contrast (spec §8, test/styles.test.ts, every accent): the accent button and the stepper on a selected row, marked
 * "contrast:" below.
 */

const SPRING = 'linear(0, 0.53 9%, 0.96 18%, 1.07 24%, 1.04 31%, 1 41%, 0.99 60%, 1)'

export const build: StyleBuild = (mode, accent) => {
  const { dark, AL, A, ink } = accentOf(mode, accent)
  const wall = dark
    ? // Softer wallpaper: low saturation and close lightness, so the glass reads over it without a loud gradient.
      'radial-gradient(100% 70% at 0% 0%, ' + rot(AL, -40, 0.45, 0.24) + ' 0%, transparent 65%), radial-gradient(100% 70% at 100% 40%, ' + rot(AL, 30, 0.45, 0.21) + ' 0%, transparent 65%), ' + rot(AL, 0, 0.3, 0.13)
    : 'radial-gradient(100% 70% at 0% 0%, ' + rot(AL, -40, 0.55, 0.85) + ' 0%, transparent 65%), radial-gradient(100% 70% at 100% 40%, ' + rot(AL, 30, 0.5, 0.84) + ' 0%, transparent 65%), ' + rot(AL, 0, 0.35, 0.9)
  const fg = dark ? '#F4F5F8' : '#14161C'
  const muted = dark ? '#C3C7D1' : '#3E4350'
  const glassBg = dark ? 'rgba(28,30,38,0.48)' : 'rgba(255,255,255,0.55)'
  const spec = dark ? 'linear-gradient(160deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 40%)' : 'linear-gradient(160deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 40%)'
  const rim = dark
    ? 'inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 1px rgba(255,255,255,0.10), 0 8px 24px -6px rgba(0,0,0,0.5)'
    : 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(255,255,255,0.25), inset 0 0 0 1px rgba(255,255,255,0.45), 0 8px 24px -6px rgba(20,24,40,0.18)'
  /** The controls' top highlight (the first line of their rim). */
  const highlight = dark ? 'inset 0 1px 0 rgba(255,255,255,0.22)' : 'inset 0 1px 0 rgba(255,255,255,0.8)'
  const ctrlRim = dark
    ? highlight + ', inset 0 0 0 1px rgba(255,255,255,0.10), 0 2px 8px rgba(0,0,0,0.3)'
    : highlight + ', inset 0 0 0 1px rgba(255,255,255,0.4), 0 2px 8px rgba(20,24,40,0.10)'
  /** The small controls' rim — icon buttons and the stepper pill (plan 12): on dark, the card's specular rim at half its
   *  alpha (top 11 %, ring 5 %), so a row of small glass buttons does not glitter brighter than the panel they sit on.
   *  Light keeps ctrlRim. */
  const smallRim = dark ? 'inset 0 1px 0 rgba(255,255,255,0.11), inset 0 0 0 1px rgba(255,255,255,0.05), 0 2px 8px rgba(0,0,0,0.3)' : ctrlRim
  const c0 = dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.40)'
  const c1 = dark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.60)'
  const c2 = dark ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.78)'
  const line = dark ? 'rgba(255,255,255,0.08)' : 'rgba(20,24,40,0.08)'
  const sf = `-apple-system, 'SF Pro Text', ${stack('Inter')}`
  const aSh = 'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 0 1px rgba(255,255,255,0.25), 0 6px 16px -4px ' + rgba(AL, 0.5)
  // contrast: dark, a flat control pressed (and the row menu "⋯" open) lights 14 %, not c1's 16 %: the menu's accent ink
  // is 4.38:1 on rose and 4.49:1 on copper there.
  const ghost = K(S('rgba(255,255,255,0)', 0, 0, muted), S(c0, 0, 0, fg), S(dark ? 'rgba(255,255,255,0.14)' : c1, 0, 0, fg, 'scale(0.92)'))
  const step = K(
    S('rgba(255,255,255,0)', 0, 0, fg),
    S(dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.35)', 0, 0, fg),
    S(dark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.7)', 0, 0, fg, 'scale(0.9)'),
  )

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: sf,
      headFont: `-apple-system, 'SF Pro Display', ${stack('Inter')}`,
      labelFont: sf,
      stroke: '1.75',
      btnWeight: '600',
      page: wall,
      // The sidebar: a pane of the glass over the wallpaper, edged by the style's hairline.
      rail: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.4)',
      fg,
      muted,
      subtle: muted,
      icon: fg,
      dimmed: dark ? '#D5D8E0' : '#2E323C',
      ink,
      hdr: dark ? 'rgba(20,22,30,0.35)' : 'rgba(255,255,255,0.35)',
      hdrBlur: 'blur(24px) saturate(180%)',
      hdrSh: dark ? 'inset 0 -1px 0 rgba(255,255,255,0.08)' : 'inset 0 -1px 0 rgba(255,255,255,0.5), 0 1px 0 rgba(20,24,40,0.06)',
      surfBlur: 'blur(20px) saturate(180%)',
      ctrlBlur: 'blur(12px) saturate(180%)',
      photo: spec + ', ' + (dark ? 'rgba(28,30,38,0.35)' : 'rgba(255,255,255,0.35)'),
      photoSh: rim,
      photoR: '26px',
      photoFg: muted,
      thumbs: [dark ? 'rgba(28,30,38,0.35)' : 'rgba(255,255,255,0.35)'],
      thumbFg: muted,
      thumbSh: ctrlRim,
      thumbR: '16px',
      chips: [c0],
      chipFgs: [fg],
      chipSh: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.12)' : 'inset 0 0 0 1px rgba(255,255,255,0.5)',
      chipR: '999px',
      card: spec + ', ' + glassBg,
      cardSh: rim,
      cardR: '26px',
      cardFg: fg,
      cardMuted: muted,
      list: spec + ', ' + glassBg,
      listSh: rim,
      listR: '22px',
      divider: '1px solid ' + line,
      cur: rgba(A, dark ? 0.24 : 0.18),
      curSh: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.12)' : 'inset 0 0 0 1px rgba(255,255,255,0.45)',
      curR: '16px',
      curM: '0 6px',
      curFg: ink,
      curMuted: muted,
      pillBg: c0,
      pillImg: 'none',
      pillSh: smallRim,
      pillR: '999px',
      seam: '1px solid ' + (dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)'),
      ibR: '999px',
      btnR: '999px',
      primR: '999px',
      ghostR: '999px',
      tr: 'background-color 220ms ease, box-shadow 220ms ease, color 220ms ease, transform 420ms ' + SPRING,
      ...glass(dark),
      popR: '22px',
      popHoverFg: ink,
      kinds: {
        ib: K(S(c0, 0, smallRim, fg), S(c1, 0, smallRim, fg), S(c2, 0, smallRim, fg, 'scale(0.92)')),
        add: K(S(c0, 0, ctrlRim, fg), S(c1, 0, ctrlRim, fg), S(c2, 0, ctrlRim, fg, 'scale(0.94)')),
        btn: K(S(c0, 0, ctrlRim, fg), S(c1, 0, ctrlRim, fg), S(c2, 0, ctrlRim, fg, 'scale(0.96)')),
        // contrast: the label is white on the tinted glass, at 4.5:1 on every accent —
        //  - no specular sheen in the fill (the mock-up's `spec` image: any white stop under a white label takes it under
        //    4.5:1); the rim's top highlight and the coloured glow stay;
        //  - light: 95 % of the accent at rest, opaque on hover (the mock-up's 86 % / 96 %: 4.0–4.3:1 on blue, teal,
        //    green, orange over the wallpaper, less over a white sheet); dark keeps 86 % / 96 %;
        //  - pressed 4 % lighter, not 14 % (3.9–4.5:1 on most accents).
        primary: K(
          S(rgba(AL, dark ? 0.86 : 0.95), 0, aSh, '#FFFFFF'),
          S(dark ? rgba(AL, 0.96) : AL, 0, aSh, '#FFFFFF'),
          S(mix(AL, '#ffffff', 0.04), 0, aSh, '#FFFFFF', 'scale(0.96)'),
        ),
        step,
        ghost,
      },
      // contrast: dark, the pressed half of the stepper on a selected row lights 12 %, not 18 % (4.1–4.5:1 on the
      // accent's tint). Light: the mock-up's (kinds.step).
      stepSel: dark ? K(step.n, step.h, S('rgba(255,255,255,0.12)', 0, 0, fg, 'scale(0.9)')) : step,
      // The flat controls of a selected row (finish()'s default: ghost with the row's muted rest text). contrast: dark,
      // the row menu "⋯" there shows accent ink, 4.5–5.1:1 on the row's tint alone: any white lift takes it under
      // (3.4–3.8:1 on the mock-up's 10 %, 2.8–3.2:1 on 16 %), so it sinks instead, 8 % black on hover and 16 % pressed.
      ghostSel: dark
        ? K({ ...ghost.n, fg: muted }, S('rgba(0,0,0,0.08)', 0, 0, fg), S('rgba(0,0,0,0.16)', 0, 0, fg, 'scale(0.92)'))
        : K({ ...ghost.n, fg: muted }, ghost.h, ghost.p),

      // contrast: dark, the stepper's pill on a selected row draws no white lift: its count and unit are the row's ink and
      // muted text, 3.4–3.8:1 on the pill's 10 % white over the row's tint (4.5:1 on the tint alone). Its rim stays.
      pillSelBg: dark ? 'rgba(255,255,255,0)' : c0,

      // App surfaces (see the header comment).
      sheet: spec + ', ' + solidOf(glassBg, solidOf(wall)),
      sheetBlur: 'none',
      // contrast: dark, the selected radio (and checkbox, switch, progress) is --primary: the accent at 86 % over the dark
      // wallpaper was 1.4–2.8:1 on the grey glass, an unselected-looking circle. Dark takes the accent lightened 45 % toward
      // white, with the dark ink for its check mark; the ring and the dot read 3:1 on page, card, list and sheet. Light keeps
      // the accent.
      primary: dark ? mix(AL, '#ffffff', 0.45) : AL,
      primaryFg: dark ? '#14161C' : '#FFFFFF',
      field: c0,
      // contrast: the field's outline (and Camera / Gallery's) is 3:1 on every surface it sits on (WCAG 1.4.11): it was the
      // divider's 8 % hairline, 1.2:1. Light 55 % of the page ink, dark 40 % white.
      fieldLine: dark ? 'rgba(255,255,255,0.4)' : 'rgba(20,24,40,0.55)',
      fieldSh: highlight,
    },
    mode,
  )
}
