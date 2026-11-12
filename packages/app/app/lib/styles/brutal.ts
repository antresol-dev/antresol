import { mix } from './color'
import { accentOf, finish, K, MOCKUP_DEFAULTS, S } from './derive'
import type { KindState, StyleBuild } from './types'

/*
 * S6 Neo-brutal / Memphis: 2 px ink lines, hard offset shadows, Memphis colour blocks, Rubik with Unbounded titles,
 * labels and numbers. The mock-up's `brutal` branch of build() (styles-mockup.dc.html), verbatim, except:
 *  - the Memphis colours always start from yellow (the owner, spec §4): the mock-up turned them to start at the chosen
 *    accent. A fixed palette: the accent given is ignored. Accent-coloured text (links, the focus ring) is the mock-up's
 *    with no accent chosen: indigo's ink.
 *  - shades changed for contrast (spec §8; test/styles-brutal.test.ts lists each): muted ink #2E2E2E → #282828 (4.29:1
 *    on the selected row's blue); light: the destructive red #C8102E → #B80F2A (4.07:1 on a hovered menu item's yellow);
 *    dark: a hovered menu item is a dark yellow with light text (on the yellow neither the light red nor the light
 *    muted text reads — the mock-up turned the hovered red to ink, the app's menus draw it in the menu's red).
 *  - app surfaces the board does not show (spec §5): sheets and dialogs are the style's panel (the list's white or
 *    dark surface with an ink line and the menu's offset shadow), not the pink card, whose ink text cannot sit on the
 *    dark theme's fields and lists; the opaque surface (the desktop tree panel, badges) likewise; the neutral chip is a
 *    shade of the page (the chips' Memphis blue does not carry the dark theme's light text); a hovered row is the
 *    mock-up's pale yellow in light, a dark yellow in dark (rows hold light text there); fields carry the ink line at
 *    the lists' 2 px (their 1 px border and a 1 px inset).
 * assets/css/styles/brutal.css draws the rest: the chips', thumbnails' and cards' colours in turn, and ink text on
 * every Memphis colour (cards, the selected row, a control under the pointer or pressed).
 */

/** The Memphis colours in the mock-up's order: yellow, pink, blue, mint, orange, violet. */
export const MEMPHIS = ['#FFD23F', '#FF7AB6', '#5B8CFF', '#3DDCAA', '#FF8C42', '#B08CFF'] as const

export const build: StyleBuild = (mode) => {
  const { dark, ink } = accentOf(mode, 'indigo')
  const P = MEMPHIS
  const lineC = dark ? '#F6EFDF' : '#111111'
  const ring = 'inset 0 0 0 2px ' + lineC
  const off = (x: number) => x + 'px ' + x + 'px 0 ' + lineC
  const surf = dark ? '#222228' : '#FFFFFF'
  const page = dark ? '#16161A' : '#FFF4DC'
  const fg = dark ? '#F6EFDF' : '#111111'
  const muted = dark ? '#CFC7B6' : '#3D3D3D'
  const onP = '#111111'
  /** Muted ink on a Memphis colour (the mock-up's #2E2E2E, darkened for the blue). */
  const onPMuted = '#282828'
  const unb = "'Unbounded', 'Rubik', system-ui, sans-serif"
  const rub = "'Rubik', system-ui, sans-serif"
  const lift = (bg: string, x: number): KindState => S(bg, 0, ring + ', ' + off(x), fg)
  const sink = (bg: string, x: number, c?: string): KindState => S(bg, 0, ring + ', 0 0 0 ' + lineC, c || onP, 'translate(' + x + 'px, ' + x + 'px)')
  // Hover is a pale version of the role's colour (ink text on it in both modes); press sinks into the shadow.
  const pale = (c: string) => mix(c, '#ffffff', dark ? 0.25 : 0.5)
  /** Dark: a hovered row or menu item, yellow deep enough for the theme's light text. */
  const hoverDark = mix(surf, P[0], 0.14)
  const danger = dark ? '#FF8A8A' : '#B80F2A'

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: rub,
      headFont: unb,
      headSize: '22px',
      headWeight: '700',
      headTrack: '-0.01em',
      labelFont: unb,
      labelSize: '12px',
      labelWeight: '700',
      labelCase: 'uppercase',
      labelTrack: '0.04em',
      numFont: unb,
      numWeight: '700',
      stroke: '2.5',
      page: 'radial-gradient(' + (dark ? 'rgba(255,255,255,0.09)' : 'rgba(17,17,17,0.14)') + ' 1.2px, transparent 1.6px) 0 0 / 22px 22px, ' + page,
      fg,
      muted,
      subtle: muted,
      icon: fg,
      dimmed: muted,
      ink,
      hdr: page,
      hdrSh: 'inset 0 -2px 0 ' + lineC,
      photo: P[5],
      photoSh: ring + ', ' + off(4),
      photoR: '12px',
      photoFg: onP,
      thumbs: [P[3], P[4], P[1]],
      thumbFg: onP,
      thumbSh: ring + ', ' + off(3),
      thumbR: '10px',
      chips: [P[2], P[3], P[4], P[5]],
      chipFgs: [onP],
      chipSh: ring,
      chipR: '999px',
      card: P[1],
      cardSh: ring + ', ' + off(4),
      cardR: '12px',
      cardFg: onP,
      cardMuted: onPMuted,
      list: surf,
      listSh: ring + ', ' + off(4),
      listR: '12px',
      divider: '1px solid ' + lineC,
      cur: P[2],
      curSh: 'inset 0 0 0 2px ' + lineC,
      curR: '8px',
      curM: '0 8px',
      curFg: onP,
      curMuted: onPMuted,
      pillBg: surf,
      pillImg: 'none',
      pillSh: ring + ', ' + off(3),
      pillR: '10px',
      seam: '1px solid ' + lineC,
      pillSelBg: '#FFFFFF',
      pillSelSh: 'inset 0 0 0 2px #111111, 3px 3px 0 #111111',
      ibR: '10px',
      btnR: '10px',
      primR: '10px',
      ghostR: '8px',
      popItemR: '8px',
      pop: surf,
      popSh: ring + ', ' + off(5),
      popR: '12px',
      popFg: fg,
      popHover: dark ? hoverDark : P[0],
      popHoverFg: dark ? fg : onP,
      popDanger: danger,
      popDiv: lineC,
      tr: 'background-color 80ms ease-out, transform 80ms ease-out, box-shadow 80ms ease-out',
      kinds: {
        ib: K(lift(surf, 3), S(pale(P[0]), 0, ring + ', ' + off(3), onP), sink(P[0], 3)),
        add: K(lift(surf, 3), S(pale(P[4]), 0, ring + ', ' + off(3), onP), sink(P[4], 3)),
        btn: K(lift(surf, 4), S(pale(P[2]), 0, ring + ', ' + off(4), onP), sink(P[2], 4)),
        primary: K(S(P[0], 0, ring + ', ' + off(4), onP), S(mix(P[0], '#ffffff', 0.3), 0, ring + ', ' + off(4), onP), sink(P[0], 4)),
        step: K(S('rgba(0,0,0,0)', 0, 0, fg), S(pale(P[3]), 0, 0, onP), S(P[3], 0, 0, onP)),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, fg), S(pale(P[0]), 0, 0, onP), S(P[0], 0, 0, onP)),
      },
      stepSel: K(S('rgba(0,0,0,0)', 0, 0, onP), S(mix(P[3], '#ffffff', 0.5), 0, 0, onP), S(P[3], 0, 0, onP)),
      ghostSel: K(S('rgba(0,0,0,0)', 0, 0, onP), S('rgba(255,255,255,0.5)', 0, 0, onP), S('#FFFFFF', 0, 0, onP)),

      // App surfaces (spec §5), where the derived default does not suit Neo-brutal (header comment).
      surface: surf,
      sheet: surf,
      sheetSh: 'inset 0 0 0 1px ' + lineC + ', ' + off(5),
      sheetLine: lineC,
      chip: mix(page, lineC, dark ? 0.12 : 0.08),
      rowHover: dark ? hoverDark : pale(P[0]),
      fieldSh: 'inset 0 0 0 1px ' + lineC,
    },
    mode,
  )
}
