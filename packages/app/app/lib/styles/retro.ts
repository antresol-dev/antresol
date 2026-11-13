import { mix } from './color'
import { accentOf, finish, K, MOCKUP_DEFAULTS, S } from './derive'
import { stack } from './fonts'
import type { StyleBuild } from './types'

/*
 * S8 Retro atomic: the 1950–60s space age — Jost in capitals, cream and teal with orange and mustard, boomerang
 * corners, print offsets, the atom-dot page. The mock-up's `retro` branch of build() (styles-mockup.dc.html),
 * verbatim, except:
 *  - a fixed palette: the accent is always teal (spec §4), whatever accent it is given;
 *  - shades changed for contrast (spec §8; test/styles-retro.test.ts lists each): the thumbnails' ink #2B2A33 →
 *    #24232B (4.26:1 on the teal thumbnail); light: the primary button's hover lightened the teal 12 %, which takes its
 *    cream text to 4.0:1, so it darkens to the pressed teal instead (pressing still sinks into the offset); dark: muted
 *    text on the selected row #C9C1AE → #dad2bf (3.89:1 on its teal), a hovered menu item is teal 18 % instead of 25 %
 *    (#425466 → #3a4a5e: the danger red #F4A58A was 3.94:1, muted text 4.36:1 on it); a flat control pressed (the
 *    open row menu's "⋯", in its accent ink) sinks 20 % darker instead of a stronger teal (#425466 → #354352: the ink
 *    was 3.94:1 on it);
 *  - app surfaces the board does not show (spec §5): the neutral chip (pinned values, skeletons, the switch's track) is
 *    a shade of the page — the first tag colour, mustard, does not carry the muted text.
 * assets/css/styles/retro.css draws the rest: dashed row dividers, the tags' and thumbnails' colours in turn, the
 * field-sized radius, the phone sheet's boomerang corners.
 */

export const build: StyleBuild = (mode) => {
  const { dark, A, ink } = accentOf(mode, 'teal')
  const jost = stack('Jost')
  const teal = '#2A9D8F'
  const orange = '#E76F51'
  const mustard = '#E9C46A'
  const surf = dark ? '#273049' : '#FBF5E6'
  const lineC = dark ? 'rgba(244,236,216,0.7)' : 'rgba(43,42,51,0.85)'
  const ring = 'inset 0 0 0 1.5px ' + lineC
  const offC = dark ? 'rgba(233,196,106,0.55)' : mustard
  const fg = dark ? '#F4ECD8' : '#2B2A33'
  const muted = dark ? '#C9C1AE' : '#625B4E'
  const pageColor = dark ? '#1C2335' : '#F3E9D2'
  const page = dark
    ? // The light theme's atom dots on the same 80 px tile: cream star where light has teal, teal where light has orange.
      'radial-gradient(circle at 20px 20px, rgba(244,236,216,0.32) 2px, transparent 2.5px) 0 0 / 80px 80px, radial-gradient(circle at 60px 52px, rgba(42,157,143,0.5) 2px, transparent 2.5px) 0 0 / 80px 80px, ' + pageColor
    : 'radial-gradient(circle at 20px 20px, rgba(42,157,143,0.20) 3px, transparent 3.5px) 0 0 / 80px 80px, radial-gradient(circle at 60px 52px, rgba(231,111,81,0.18) 2px, transparent 2.5px) 0 0 / 80px 80px, ' + pageColor
  const boom = '26px 8px 26px 8px'
  const tnt = (x: number) => mix(A, surf, 1 - x)
  const onPrimary = dark ? '#1C2335' : '#FBF5E6'
  const primaryPressed = mix(A, '#000000', 0.08)

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: jost,
      headFont: jost,
      headSize: '22px',
      headWeight: '600',
      headTrack: '0.06em',
      headCase: 'uppercase',
      labelFont: jost,
      labelSize: '12px',
      labelWeight: '600',
      labelCase: 'uppercase',
      labelTrack: '0.16em',
      mark: '✦ ',
      markColor: orange,
      numWeight: '600',
      btnWeight: '600',
      page,
      // The sidebar: the cream a shade toward tan (no atoms), cut off by the style's 1.5 px ink outline.
      rail: dark ? 'rgba(0,0,0,0.18)' : 'rgba(150,100,40,0.08)',
      railLine: '1.5px solid ' + lineC,
      fg,
      muted,
      subtle: muted,
      icon: fg,
      dimmed: muted,
      ink,
      hdr: pageColor,
      hdrSh: 'inset 0 -1.5px 0 ' + lineC,
      photo: '#1F7A70',
      photoSh: ring,
      photoR: boom,
      photoFg: '#FBF5E6',
      thumbs: [mustard, orange, teal],
      thumbFg: '#24232B',
      thumbSh: ring,
      thumbR: '999px',
      chips: [mustard, '#9FD3C7', '#F4A58A'],
      chipFgs: ['#2B2A33'],
      chipSh: ring,
      chipR: '999px',
      card: surf,
      cardSh: ring + ', 4px 4px 0 ' + offC,
      cardR: boom,
      cardFg: fg,
      cardMuted: muted,
      list: surf,
      listSh: ring + ', 4px 4px 0 ' + offC,
      listR: '22px 8px 22px 8px',
      divider: '1px dashed ' + (dark ? 'rgba(244,236,216,0.25)' : 'rgba(43,42,51,0.25)'),
      cur: mix(A, surf, dark ? 0.7 : 0.8),
      curSh: 'none',
      curR: '16px 6px 16px 6px',
      curM: '0 6px',
      curFg: dark ? '#F4ECD8' : '#2B2A33',
      curMuted: dark ? mix(muted, fg, 0.4) : muted,
      pillBg: surf,
      pillImg: 'none',
      pillSh: ring,
      pillR: '999px',
      seam: '1px dashed ' + lineC,
      ibR: '999px',
      btnR: '999px',
      primR: '999px',
      ghostR: '999px',
      popItemR: '999px',
      pop: surf,
      popSh: ring + ', 5px 5px 0 ' + teal,
      popR: '18px 6px 18px 6px',
      popFg: fg,
      popHover: mix(A, surf, dark ? 0.82 : 0.85),
      popHoverFg: fg,
      popDanger: dark ? '#F4A58A' : '#B3261E',
      popDiv: dark ? 'rgba(244,236,216,0.25)' : 'rgba(43,42,51,0.2)',
      tr: 'background-color 200ms ease-in-out, color 200ms ease-in-out, transform 140ms ease-out, box-shadow 140ms ease-out',
      kinds: {
        ib: K(S(surf, 0, ring, fg), S(tnt(0.15), 0, ring, fg), S(tnt(0.25), 0, ring + ', inset 2px 2px 0 rgba(43,42,51,0.2)', fg)),
        add: K(S(surf, 0, ring + ', 3px 3px 0 ' + offC, fg), S(tnt(0.15), 0, ring + ', 3px 3px 0 ' + offC, fg), S(tnt(0.25), 0, ring + ', 0 0 0 ' + offC, fg, 'translate(3px, 3px)')),
        btn: K(S(surf, 0, ring + ', 3px 3px 0 ' + offC, fg), S(tnt(0.15), 0, ring + ', 3px 3px 0 ' + offC, fg), S(tnt(0.25), 0, ring + ', 0 0 0 ' + offC, fg, 'translate(3px, 3px)')),
        primary: K(
          S(A, 0, ring + ', 3px 3px 0 ' + orange, onPrimary),
          S(dark ? mix(A, '#ffffff', 0.12) : primaryPressed, 0, ring + ', 3px 3px 0 ' + orange, onPrimary),
          S(primaryPressed, 0, ring + ', 0 0 0 ' + orange, onPrimary, 'translate(3px, 3px)'),
        ),
        step: K(S('rgba(0,0,0,0)', 0, 0, fg), S(tnt(0.15), 0, 0, fg), S(tnt(0.28), 0, 'inset 2px 2px 0 rgba(43,42,51,0.18)', fg)),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, muted), S(tnt(0.15), 0, 0, fg), S(dark ? mix(tnt(0.25), '#000000', 0.2) : tnt(0.25), 0, 0, fg)),
      },

      // App surfaces (spec §5), where the derived default does not suit Retro atomic (header comment).
      chip: mix(pageColor, dark ? '#F4ECD8' : '#2B2A33', dark ? 0.12 : 0.08),
    },
    mode,
  )
}
