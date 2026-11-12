import { mix, rot, solidOf } from './color'
import { K, MOCKUP_DEFAULTS, S, accentOf, finish } from './derive'
import { stack } from './fonts'
import type { StyleBuild } from './types'

/*
 * S3 Acrylic — Windows 11 Fluent: a Mica window over a wallpaper, acrylic flyouts, 4/8 px corners. The mock-up's
 * `acrylic` branch of build(), verbatim; main.css draws the window layer (winBg, winBlur) on body::before, and the
 * grain is in the menu's background. Its own CSS: assets/css/styles/acrylic.css.
 *
 * What the app adds (spec §5), each for a case the mock-up's screen does not have:
 *  - the header is in-app acrylic (the window's tint at 60 % with the flyouts' blur), not transparent: in the app it is
 *    sticky and content scrolls under it;
 *  - sheets and dialogs are the card as it looks on the window, opaque: they sit over the scrim, where a 70 % white
 *    card turns grey (and on the phone the search palette fills the screen); no blur behind an opaque pane;
 *  - fields wear the control fill with Fluent's elevation edge (ctrlSh's second line); their ring is the list's.
 *
 * Contrast (spec §8, test/styles.test.ts, every accent): the accent button's states, marked "contrast:" below.
 */

export const build: StyleBuild = (mode, accent) => {
  const { dark, AL, A, ink } = accentOf(mode, accent)
  const wall = dark
    ? 'radial-gradient(120% 80% at 0% 0%, ' + rot(AL, -25, 0.7, 0.3) + ' 0%, transparent 60%), radial-gradient(100% 70% at 100% 35%, ' + rot(AL, 35, 0.7, 0.24) + ' 0%, transparent 60%), radial-gradient(120% 80% at 30% 100%, ' + rot(AL, 0, 0.7, 0.2) + ' 0%, transparent 65%), ' + mix(AL, '#000000', 0.86)
    : 'radial-gradient(120% 80% at 0% 0%, ' + rot(AL, -25, 0.85, 0.78) + ' 0%, transparent 60%), radial-gradient(100% 70% at 100% 35%, ' + rot(AL, 35, 0.8, 0.72) + ' 0%, transparent 60%), radial-gradient(120% 80% at 30% 100%, ' + rot(AL, 0, 0.75, 0.66) + ' 0%, transparent 65%), ' + mix(AL, '#ffffff', 0.8)
  const fg = dark ? '#FFFFFF' : '#1B1B1B'
  const muted = dark ? '#C9C9C9' : '#5C5C5C'
  const ring = dark ? 'inset 0 0 0 1px rgba(255,255,255,0.07)' : 'inset 0 0 0 1px rgba(0,0,0,0.0578)'
  const ctrl = dark ? 'rgba(255,255,255,0.0605)' : 'rgba(255,255,255,0.7)'
  /** The control's elevation edge: a light top line on dark, a darker bottom line on light. */
  const elevation = dark ? 'inset 0 1px 0 rgba(255,255,255,0.09)' : 'inset 0 -1px 0 rgba(0,0,0,0.1622)'
  const ctrlSh = (dark ? 'inset 0 0 0 1px rgba(255,255,255,0.06), ' : 'inset 0 0 0 1px rgba(0,0,0,0.0578), ') + elevation
  const subtle = dark ? 'rgba(255,255,255,0.0605)' : 'rgba(0,0,0,0.0373)'
  const subtleP = dark ? 'rgba(255,255,255,0.0419)' : 'rgba(0,0,0,0.0241)'
  const grain = 'repeating-radial-gradient(circle at 17% 32%, ' + (dark ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.02)') + ' 0 0.6px, transparent 0.6px 2.2px)'
  const segoe = `'Segoe UI Variable Text', 'Segoe UI', ${stack('Inter')}`
  const winBg = dark ? 'rgba(32,32,32,0.84)' : 'rgba(243,243,243,0.82)'
  const card = dark ? 'rgba(255,255,255,0.0512)' : 'rgba(255,255,255,0.7)'
  /** The flyouts' acrylic blur. */
  const acrylic = 'blur(30px) saturate(150%)'

  const priFg = dark ? '#000000' : '#FFFFFF'
  const priSh = dark ? 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.14)' : 'inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.4)'
  const btnH = dark ? 'rgba(255,255,255,0.0837)' : 'rgba(249,249,249,0.5)'
  const btnP = dark ? 'rgba(255,255,255,0.0326)' : 'rgba(249,249,249,0.3)'
  const ghost = K(S('rgba(0,0,0,0)', 0, 0, muted), S(subtle, 0, 0, fg), S(subtleP, 0, 0, muted))

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: segoe,
      headFont: `'Segoe UI Variable Display', 'Segoe UI', ${stack('Inter')}`,
      headWeight: '600',
      headTrack: '0',
      labelFont: segoe,
      labelSize: '14px',
      btnWeight: '600',
      stroke: '1.5',
      page: wall,
      winBg,
      winBlur: 'blur(60px) saturate(140%)',
      fg,
      muted,
      subtle: muted,
      icon: fg,
      dimmed: dark ? '#DADADA' : '#3D3D3D',
      ink,
      // The mock-up: 'transparent' (its header never has content under it). No grain: across the header's width the
      // grain's rings show as a moiré.
      hdr: dark ? 'rgba(32,32,32,0.6)' : 'rgba(243,243,243,0.6)',
      hdrBlur: acrylic,
      hdrSh: 'inset 0 -1px 0 ' + (dark ? 'rgba(255,255,255,0.0837)' : 'rgba(0,0,0,0.0578)'),
      photo: subtle,
      photoSh: ring,
      photoR: '8px',
      photoFg: muted,
      thumbs: [subtle],
      thumbFg: muted,
      thumbSh: ring,
      thumbR: '4px',
      chips: [subtle],
      chipFgs: [fg],
      chipSh: ring,
      chipR: '4px',
      card,
      cardSh: ring,
      cardR: '8px',
      cardFg: fg,
      cardMuted: muted,
      list: card,
      listSh: ring,
      listR: '8px',
      divider: '1px solid ' + (dark ? 'rgba(255,255,255,0.0837)' : 'rgba(0,0,0,0.0578)'),
      // Fluent's selected list item: a subtle fill and a 3 px accent pill at the start.
      cur: 'linear-gradient(' + A + ', ' + A + ') left 2px center / 3px 18px no-repeat, ' + subtle,
      curSh: 'none',
      curR: '4px',
      curM: '0 4px',
      curFg: fg,
      curMuted: muted,
      pillBg: ctrl,
      pillImg: 'none',
      pillSh: ctrlSh,
      pillR: '4px',
      seam: '1px solid ' + (dark ? 'rgba(255,255,255,0.0837)' : 'rgba(0,0,0,0.0578)'),
      ibR: '4px',
      btnR: '4px',
      primR: '4px',
      ghostR: '4px',
      popItemR: '4px',
      pop: grain + ', ' + (dark ? 'rgba(44,44,44,0.88)' : 'rgba(252,252,252,0.85)'),
      popBlur: acrylic,
      popSh: dark ? '0 8px 16px rgba(0,0,0,0.26), inset 0 0 0 1px rgba(255,255,255,0.08)' : '0 8px 16px rgba(0,0,0,0.14), inset 0 0 0 1px rgba(0,0,0,0.0578)',
      popR: '8px',
      popFg: fg,
      popHover: subtle,
      popHoverFg: fg,
      popDanger: dark ? '#FF99A4' : '#C42B1C',
      popDiv: dark ? 'rgba(255,255,255,0.0837)' : 'rgba(0,0,0,0.0803)',
      tr: 'background-color 83ms linear, color 83ms linear, box-shadow 83ms linear',
      kinds: {
        ib: K(S('rgba(0,0,0,0)', 0, 0, fg), S(subtle, 0, 0, fg), S(subtleP, 0, 0, muted)),
        add: K(S(ctrl, 0, ctrlSh, fg), S(btnH, 0, ctrlSh, fg), S(btnP, 0, ring, muted)),
        btn: K(S(ctrl, 0, ctrlSh, fg), S(btnH, 0, ctrlSh, fg), S(btnP, 0, ring, muted)),
        primary: K(
          S(A, 0, priSh, priFg),
          // contrast: light hover 5 % lighter (the mock-up's 10 % takes white text to 4.2–4.5:1 on blue, teal, green,
          // orange).
          S(mix(A, dark ? '#000000' : '#ffffff', dark ? 0.1 : 0.05), 0, priSh, priFg),
          // contrast: pressed keeps Fluent's dimmed label, 78 % on both themes; light darkens 15 % instead of the
          // mock-up's 20 % lighter (2.8–3.5:1), dark keeps its 20 % darker fill with 78 % black text, not 60 % (3.4–3.7:1).
          S(mix(A, '#000000', dark ? 0.2 : 0.15), 0, 'inset 0 0 0 1px rgba(255,255,255,0.08)', dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.78)'),
        ),
        step: K(S('rgba(0,0,0,0)', 0, 0, fg), S(subtle, 0, 0, fg), S(subtleP, 0, 0, muted)),
        ghost,
      },
      // The flat controls of a selected row (finish()'s default: ghost with the row's muted rest text). contrast: dark,
      // the row menu "⋯" there hovers on 5 % white, not 6.05 % (its accent ink 4.38:1 on rose).
      ghostSel: K({ ...ghost.n, fg: muted }, dark ? S('rgba(255,255,255,0.05)', 0, 0, fg) : ghost.h, ghost.p),

      // App surfaces (see the header comment).
      sheet: solidOf(card, solidOf(winBg + ', ' + wall)),
      sheetBlur: 'none',
      field: ctrl,
      // contrast: the field's outline (and Camera / Gallery's) is 3:1 on every surface it sits on (WCAG 1.4.11): it was the list's
      // 6–7 % hairline, 1.1–1.2:1. Light 47 % black, dark 40 % white.
      fieldLine: dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.47)',
      fieldSh: elevation,
    },
    mode,
  )
}
