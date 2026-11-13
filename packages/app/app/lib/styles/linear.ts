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
  const surf = dark ? '#101113' : '#FFFFFF'
  const fg = dark ? '#F7F8F8' : '#1A1B1E'
  const muted = dark ? '#8A8F98' : '#62666D'
  const icon = dark ? '#C9CCD1' : '#3C3F45'
  const ring = dark ? 'inset 0 0 0 1px rgba(255,255,255,0.07)' : 'inset 0 0 0 1px rgba(0,0,0,0.08)'
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
      page: dark ? '#08090A' : '#F7F7F8',
      // Linear's sidebar: a shade off the content, with a hairline.
      rail: dark ? 'rgba(255,255,255,0.022)' : 'rgba(0,0,0,0.022)',
      fg,
      muted,
      subtle: muted,
      icon,
      dimmed: dark ? '#B4B8BF' : '#4A4D53',
      ink,
      hdr: dark ? '#08090A' : '#F7F7F8',
      hdrSh: 'inset 0 -1px 0 ' + (dark ? 'rgba(255,255,255,0.06)' : '#E8E8EA'),
      photo: dark ? '#16171A' : '#EFEFF1',
      photoSh: ring,
      photoR: '8px',
      photoFg: muted,
      thumbs: [dark ? '#16171A' : '#EFEFF1'],
      thumbFg: muted,
      thumbSh: ring,
      thumbR: '6px',
      chips: [surf],
      chipFgs: [dark ? '#B4B8BF' : '#4A4D53'],
      chipSh: ring,
      chipR: '999px',
      card: surf,
      cardSh: ring + (dark ? '' : ', 0 1px 2px rgba(0,0,0,0.04)'),
      cardR: '8px',
      cardFg: fg,
      cardMuted: muted,
      list: surf,
      listSh: ring + (dark ? '' : ', 0 1px 2px rgba(0,0,0,0.04)'),
      listR: '8px',
      divider: '1px solid ' + (dark ? 'rgba(255,255,255,0.06)' : '#EFEFF1'),
      cur: hov,
      curSh: 'none',
      curR: '6px',
      curM: '0 6px',
      curFg: fg,
      curMuted: muted,
      pillBg: dark ? '#16171A' : surf,
      pillImg: 'none',
      pillSh: ring,
      pillR: '6px',
      seam: '1px solid ' + (dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'),
      ibR: '6px',
      btnR: '6px',
      primR: '6px',
      ghostR: '6px',
      popItemR: '6px',
      pop: dark ? 'rgba(22,23,26,0.94)' : 'rgba(255,255,255,0.92)',
      popBlur: 'blur(12px)',
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
        add: K(S(dark ? '#16171A' : surf, 0, btnSh, icon), S(dark ? '#1B1C1F' : '#F7F7F8', 0, btnSh, fg), S(dark ? '#202124' : '#F1F1F2', 0, ring, fg)),
        btn: K(S(dark ? '#16171A' : surf, 0, btnSh, fg), S(dark ? '#1B1C1F' : '#F7F7F8', 0, btnSh, fg), S(dark ? '#202124' : '#F1F1F2', 0, ring, fg)),
        primary: K(S(AL, 0, priSh, '#FFFFFF'), S(mix(AL, '#ffffff', lift), 0, priSh, '#FFFFFF'), S(mix(AL, '#000000', 0.08), 0, priSh, '#FFFFFF')),
        step: K(S('rgba(0,0,0,0)', 0, 0, icon), S(hov, 0, 0, fg), S(prs, 0, 0, fg)),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, muted), S(hov, 0, 0, fg), S(prs, 0, 0, fg)),
      },

      chip: dark ? '#202124' : '#EFEFF1',
      fieldLine: dark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.15)',
      border: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    },
    mode,
  )
}
