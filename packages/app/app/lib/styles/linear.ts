import { upTo } from './base'
import { mix } from './color'
import { accentOf, FONT, K, MOCKUP_DEFAULTS, S, finish } from './derive'
import type { StyleBuild } from './types'

/*
 * S5 Linear — strict SaaS: Inter, hairlines, 6/8 px corners, almost no colour. The mock-up's `linear` branch of
 * build() (styles-mockup.dc.html), verbatim, except:
 *
 * Shade picked for contrast (spec §8; the mock-up's amount wherever its text reads at 4.5:1, so indigo, the default,
 * is the mock-up's): the primary button's hover lifts the accent 8 % toward white, or less: as far as white text stays
 * at 4.5:1 (green: 5 %; 8 % takes it to 4.35:1).
 *
 * Set apart from Base (plan 12, F7): no elevation anywhere — every card and list is its 1 px hairline (`inset 0 0 0 1px
 * <border>`), rows split by 1 px lines; corners 8 on cards and lists, 6 on buttons and fields, 4 on tags and small
 * things (the mock-up's tags were capsules). Dark: the page #0B0B0D, cards #161618 (about 5 % OKLCH lightness up) with a
 * 10 % white hairline that reads; controls, chips and menus step up from the card.
 *
 * App surfaces the mock-up does not draw (spec §5; derive.ts derives the rest):
 *  - the neutral chip (counts, pinned values, skeletons, the switch's off track) is the photo's grey (light) and the
 *    pressed fill (dark): the mock-up's tag is the surface itself with a ring, which the app's plain chips lack, so
 *    they would vanish into the list;
 *  - fields and checkboxes keep the list's surface; their line is a stronger hairline than the card's ring, which
 *    hardly shows on a 16 px checkbox;
 *  - generic lines (boxes, the tree panel's edge, toasts) are the card's ring colour.
 */

export const build: StyleBuild = (mode, accent) => {
  const { dark, AL, ink } = accentOf(mode, accent)
  const surf = dark ? '#161618' : '#FFFFFF'
  /** Dark: a control's fill on the card, a step above it, and its hover and press. */
  const ctl = ['#1C1C1F', '#212124', '#26262A'] as const
  const fg = dark ? '#F7F8F8' : '#1A1B1E'
  const muted = dark ? '#8A8F98' : '#62666D'
  const icon = dark ? '#C9CCD1' : '#3C3F45'
  /** The hairline every box is drawn with (and the generic line colour). */
  const line = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
  const ring = 'inset 0 0 0 1px ' + line
  const hov = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'
  const prs = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'
  const btnSh = ring + (dark ? ', inset 0 1px 0 rgba(255,255,255,0.04)' : ', 0 1px 1px rgba(0,0,0,0.03)')
  const priSh = 'inset 0 1px 0 rgba(255,255,255,0.16), inset 0 0 0 1px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)'
  const lift = upTo(0.08, (x) => [mix(AL, '#ffffff', x)], '#FFFFFF')

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: FONT.inter,
      headFont: FONT.inter,
      headWeight: '600',
      headTrack: '-0.015em',
      labelFont: FONT.inter,
      labelSize: '12px',
      labelWeight: '500',
      numWeight: '600',
      btnWeight: '500',
      stroke: '1.5',
      page: dark ? '#0B0B0D' : '#F7F7F8',
      // Linear's sidebar: a shade off the content, with a hairline.
      rail: dark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.022)',
      fg,
      muted,
      subtle: muted,
      icon,
      dimmed: dark ? '#B4B8BF' : '#4A4D53',
      ink,
      hdr: dark ? '#0B0B0D' : '#F7F7F8',
      hdrSh: 'inset 0 -1px 0 ' + (dark ? 'rgba(255,255,255,0.06)' : '#E8E8EA'),
      photo: dark ? ctl[0] : '#EFEFF1',
      photoSh: ring,
      photoR: '8px',
      photoFg: muted,
      thumbs: [dark ? ctl[0] : '#EFEFF1'],
      thumbFg: muted,
      thumbSh: ring,
      thumbR: '6px',
      chips: [surf],
      chipFgs: [dark ? '#B4B8BF' : '#4A4D53'],
      chipSh: ring,
      chipR: '4px',
      card: surf,
      cardSh: ring,
      cardR: '8px',
      cardFg: fg,
      cardMuted: muted,
      list: surf,
      listSh: ring,
      listR: '8px',
      divider: '1px solid ' + (dark ? 'rgba(255,255,255,0.06)' : '#EFEFF1'),
      cur: hov,
      curSh: 'none',
      curR: '6px',
      curM: '0 6px',
      curFg: fg,
      curMuted: muted,
      pillBg: dark ? ctl[0] : surf,
      pillImg: 'none',
      pillSh: ring,
      pillR: '6px',
      seam: '1px solid ' + (dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'),
      ibR: '6px',
      btnR: '6px',
      primR: '6px',
      ghostR: '6px',
      popItemR: '6px',
      pop: dark ? 'rgba(30,30,34,0.94)' : 'rgba(255,255,255,0.92)',
      popBlur: 'blur(12px)',
      // contrast: dark, the selected radio (and checkbox, switch, progress) is --primary: the accent was 2.4-3.0:1 on the dark
      // surfaces for indigo, rose, pink and slate. Dark takes the accent lightened 30 % toward white with the dark ink for its
      // check mark (the primary button keeps the saturated fill); light keeps the accent.
      primary: dark ? mix(AL, '#ffffff', 0.3) : AL,
      primaryFg: dark ? '#0B0B0D' : '#FFFFFF',
      popSh: dark ? '0 0 0 1px rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.5)' : '0 0 0 1px rgba(0,0,0,0.08), 0 8px 24px rgba(0,0,0,0.10)',
      popR: '8px',
      popFg: fg,
      popHover: hov,
      popHoverFg: fg,
      popDanger: dark ? '#F2797A' : '#C93C37',
      popDiv: dark ? 'rgba(255,255,255,0.06)' : '#EFEFF1',
      tr: 'background-color 100ms ease, color 100ms ease, box-shadow 100ms ease',
      // Linear keeps its saturated brand fill on dark too.
      kinds: {
        ib: K(S('rgba(0,0,0,0)', 0, 0, icon), S(hov, 0, 0, fg), S(prs, 0, 0, fg)),
        add: K(S(dark ? ctl[0] : surf, 0, btnSh, icon), S(dark ? ctl[1] : '#F7F7F8', 0, btnSh, fg), S(dark ? ctl[2] : '#F1F1F2', 0, ring, fg)),
        btn: K(S(dark ? ctl[0] : surf, 0, btnSh, fg), S(dark ? ctl[1] : '#F7F7F8', 0, btnSh, fg), S(dark ? ctl[2] : '#F1F1F2', 0, ring, fg)),
        primary: K(S(AL, 0, priSh, '#FFFFFF'), S(mix(AL, '#ffffff', lift), 0, priSh, '#FFFFFF'), S(mix(AL, '#000000', 0.08), 0, priSh, '#FFFFFF')),
        step: K(S('rgba(0,0,0,0)', 0, 0, icon), S(hov, 0, 0, fg), S(prs, 0, 0, fg)),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, muted), S(hov, 0, 0, fg), S(prs, 0, 0, fg)),
      },

      chip: dark ? ctl[2] : '#EFEFF1',
      fieldLine: dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.15)',
      border: line,
      // Small things (counts, pins, tooltips, list thumbnails, icon tiles, crumb links) as square as the tags.
      smallR: '4px',
    },
    mode,
  )
}
