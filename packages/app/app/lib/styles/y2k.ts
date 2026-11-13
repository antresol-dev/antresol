import { mix, rgba, rot } from './color'
import { accentOf, K, MOCKUP_DEFAULTS, S, finish } from './derive'
import { stack } from './fonts'
import type { StyleBuild } from './types'

/*
 * S7 Y2K: iridescent pastels, frosted bubbles, chrome and aqua gel buttons (the owner's board S7). The mock-up's `y2k`
 * branch of build(), verbatim. The pastels (thumbnails, chips, the dark wallpaper's second glow) are the accent's
 * neighbours: rot() turns its hue.
 *
 * Where it differs from the mock-up: shades chosen so every text reads at 4.5:1 or better in every accent (spec §8;
 * each one, with its numbers, is in Plan 10 Task 6's report). Green and blue bind: they carry white at barely 5:1.
 *  - Aqua gel (the primary button): the shine is a layer of its own whose horizon sits at 30–32 % instead of
 *    48–50 %, so the label (36–64 % of the button) lies on the paint, not under 25–40 % white; the bottom glow is
 *    0.1 (pressed 0.06) instead of 0.2 (0.12); the paint is the accent 12 % deeper, hover lifts it 4 % (not 12 %) and
 *    press deepens it 10 %. The hover still glows (its halo is the mock-up's).
 *  - Danger text on light: #B8165A instead of #C0185D (4.37:1 on the lavender of the wallpaper).
 *  - Stepper pressed tint on light: 16 % instead of 24 %.
 *  - Flat controls' text on hover and press, light: the accent 30 % deeper instead of 18 % (in a sheet, over the dark
 *    scrim, the 20 % tint is darker and the ink on it read 4.0–4.4:1).
 *  - Dark chrome under the pointer: tinted with the deep accent instead of the pastel, and the label stays the
 *    foreground (the pastel on a pastel-tinted chrome reads 1.6:1); the stepper on the chrome likewise keeps the
 *    foreground on hover and press.
 *  - Dark selected row: the accent at 22 % instead of 24 % (rose's text 4.44:1).
 *  - The "⋯" on a selected row (the mock-up stacks a second accent tint, 3.2–4.5:1): a frosted white bubble on light,
 *    a navy well on dark.
 *  - Sheets and dialogs on light (the app's surface; spec §5 makes it the card): frost 0.85 instead of the card's 0.62.
 *    They lie over the dark scrim, not the wallpaper: 0.62 white over it is grey, and muted text, accent ink and danger
 *    on it read 2.9–3.7:1.
 *
 * App surfaces set here: `sheet` (above) and `smallR` 22px (not the flat controls' 999px: the same capsules and
 * circles up to 44 px, but a tall element stays a rounded box); y2k.css caps the markup's field radius likewise.
 */

export const build: StyleBuild = (mode, accent) => {
  const { dark, AL, AD, A, ink } = accentOf(mode, accent)
  const exo = stack('Exo 2')
  const fg = dark ? '#EEF0FF' : '#1B1A3A'
  const muted = dark ? '#B4B8E0' : '#4E4B78'
  const page = dark
    ? 'radial-gradient(rgba(255,255,255,0.55) 0.8px, transparent 1.2px) 0 0 / 38px 38px, radial-gradient(70% 50% at 20% 0%, ' + rgba(AL, 0.45) + ', transparent 60%), radial-gradient(70% 50% at 90% 60%, ' + rgba(rot(AL, 70, 0.8, 0.55), 0.35) + ', transparent 60%), #0B0D26'
    : 'repeating-linear-gradient(0deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 28px), linear-gradient(135deg, #BAE6FD, #E9D5FF 50%, #FDE0F0)'
  const frost = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.62)'
  const gloss = dark ? 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0) 35%)' : 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0) 35%)'
  const edge = dark
    ? 'inset 0 0 0 1px rgba(255,255,255,0.16), inset 0 1px 0 rgba(255,255,255,0.22), 0 0 24px -8px ' + rgba(A, 0.6)
    : 'inset 0 0 0 1px rgba(255,255,255,0.9), 0 6px 18px -6px rgba(90,80,180,0.35)'
  const chrome = dark ? 'linear-gradient(180deg, #5A6380 0%, #2C3248 50%, #1F2436 51%, #3A4260 100%)' : 'linear-gradient(180deg, #FFFFFF 0%, #E3E8F2 50%, #D3DAE8 51%, #EEF1F8 100%)'
  const chromeH = dark
    ? 'linear-gradient(180deg, ' + mix(AL, '#5A6380', 0.5) + ' 0%, #2C3248 50%, #1F2436 51%, ' + mix(AL, '#3A4260', 0.6) + ' 100%)'
    : 'linear-gradient(180deg, #FFFFFF 0%, ' + mix(A, '#ffffff', 0.85) + ' 50%, ' + mix(A, '#ffffff', 0.72) + ' 51%, ' + mix(A, '#ffffff', 0.9) + ' 100%)'
  const chromeP = dark ? 'linear-gradient(180deg, #1F2436 0%, #2C3248 100%)' : 'linear-gradient(180deg, #D3DAE8 0%, #E9EDF5 100%)'
  const cRing = dark ? 'inset 0 0 0 1px #6C7699, inset 0 1px 0 rgba(255,255,255,0.25), 0 2px 6px rgba(0,0,0,0.4)' : 'inset 0 0 0 1px #AEB8CC, inset 0 1px 0 #FFFFFF, 0 2px 4px rgba(60,70,110,0.18)'
  const cPress = dark ? 'inset 0 0 0 1px #6C7699, inset 0 2px 5px rgba(0,0,0,0.5)' : 'inset 0 0 0 1px #AEB8CC, inset 0 2px 5px rgba(60,70,110,0.3)'
  // The gel: a shine over the top third, then a glow rising from the middle to the bottom edge.
  const gelOf = (shine: number, rim: number, glow: number) =>
    'linear-gradient(180deg, rgba(255,255,255,' + shine + ') 0%, rgba(255,255,255,' + rim + ') 30%, rgba(255,255,255,0) 32%), linear-gradient(180deg, rgba(255,255,255,0) 50%, rgba(255,255,255,' + glow + ') 100%)'
  const gel = gelOf(0.75, 0.25, 0.1)
  const gelP = gelOf(0.35, 0.1, 0.06)
  const paint = mix(AL, '#000000', 0.12)
  const gelSh = 'inset 0 0 0 1px ' + mix(AL, '#000000', 0.3) + ', 0 4px 12px -2px ' + rgba(AL, 0.55)
  const pastel = (deg: number) => (dark ? rgba(rot(AL, deg, 0.7, 0.6), 0.28) : rot(AL, deg, 0.85, 0.88))
  const cBg = dark ? '#2C3248' : '#E3E8F2'
  /** Text on chrome under the pointer: accent ink on light; the foreground on dark (the pastel ink on chrome is 1.6:1). */
  const chromeInk = dark ? fg : ink
  /** Text of flat controls under the pointer: on light, in a sheet (over the dark scrim) the 20 % tint is darker than on
   *  the wallpaper, and the accent ink on it read 4.0–4.4:1; the accent 30 % deeper reads 4.5:1 or better there. */
  const ghostInk = dark ? ink : mix(AL, '#000000', 0.3)

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: exo,
      headFont: exo,
      headWeight: '700',
      headTrack: '0',
      labelFont: exo,
      labelSize: '12px',
      labelCase: 'uppercase',
      labelTrack: '0.12em',
      mark: '✦ ',
      markColor: dark ? AD : AL,
      page,
      // The sidebar: a frosted panel over the page, edged by the style's line.
      rail: dark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.45)',
      fg,
      muted,
      subtle: muted,
      icon: fg,
      dimmed: muted,
      ink,
      hdr: dark ? 'rgba(11,13,38,0.5)' : 'rgba(255,255,255,0.5)',
      hdrBlur: 'blur(12px)',
      hdrSh: dark ? 'inset 0 -1px 0 rgba(255,255,255,0.12)' : 'inset 0 -1px 0 rgba(255,255,255,0.9), 0 1px 0 rgba(120,110,200,0.15)',
      surfBlur: 'blur(10px)',
      photo: gloss + ', ' + frost,
      photoSh: edge,
      photoR: '22px',
      photoFg: muted,
      thumbs: [pastel(0), pastel(60), pastel(-60)],
      thumbFg: fg,
      thumbSh: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.18)' : 'inset 0 0 0 1px rgba(255,255,255,0.9), 0 2px 6px rgba(90,80,180,0.2)',
      thumbR: '16px',
      chips: [pastel(0), pastel(60), pastel(120), pastel(-60)],
      chipFgs: [fg],
      chipSh: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.06)',
      chipR: '999px',
      card: gloss + ', ' + frost,
      cardSh: edge,
      cardR: '22px',
      cardFg: fg,
      cardMuted: muted,
      list: gloss + ', ' + frost,
      listSh: edge,
      listR: '22px',
      divider: '1px solid ' + (dark ? 'rgba(255,255,255,0.08)' : 'rgba(120,110,200,0.18)'),
      cur: 'linear-gradient(180deg, rgba(255,255,255,' + (dark ? '0.12' : '0.5') + '), rgba(255,255,255,0) 50%), ' + rgba(A, dark ? 0.22 : 0.18),
      curSh: dark ? 'inset 0 0 0 1px rgba(255,255,255,0.18)' : 'inset 0 0 0 1px rgba(255,255,255,0.8)',
      curR: '16px',
      curM: '0 6px',
      curFg: ink,
      curMuted: muted,
      pillBg: cBg,
      pillImg: chrome,
      pillSh: cRing,
      pillR: '999px',
      seam: '1px solid ' + (dark ? '#6C7699' : '#AEB8CC'),
      ibR: '999px',
      btnR: '999px',
      primR: '999px',
      ghostR: '999px',
      popItemR: '14px',
      pop: dark ? 'rgba(20,22,60,0.72)' : 'rgba(255,255,255,0.72)',
      popBlur: 'blur(14px) saturate(160%)',
      popSh: dark
        ? 'inset 0 0 0 1px rgba(255,255,255,0.18), 0 12px 30px -8px rgba(0,0,0,0.6), 0 0 24px -6px ' + rgba(A, 0.6)
        : 'inset 0 0 0 1px rgba(255,255,255,0.95), 0 12px 30px -8px rgba(90,80,180,0.45)',
      popR: '20px',
      popFg: fg,
      popHover: rgba(A, dark ? 0.22 : 0.14),
      popHoverFg: ink,
      popDanger: dark ? '#FF9EC4' : '#B8165A',
      popDiv: dark ? 'rgba(255,255,255,0.1)' : 'rgba(120,110,200,0.18)',
      tr: 'background-color 160ms ease, box-shadow 160ms ease, color 160ms ease, transform 260ms cubic-bezier(0.34,1.56,0.64,1)',
      sheet: gloss + ', ' + (dark ? frost : 'rgba(255,255,255,0.85)'),
      // Chips, row "⋯" buttons, folder icons and list thumbnails (none taller than 44 px) stay capsules and circles as
      // with the mock-up's 999px; a two-line tooltip or a skeleton block becomes a rounded box instead of a pill.
      smallR: '22px',
      // contrast: the field's outline (and Camera / Gallery's) is 3:1 on every surface it sits on (WCAG 1.4.11): it was the list's
      // white rim, 1.0–1.3:1 in light. Light 68 % of the style's violet-ink, dark 40 % white.
      fieldLine: dark ? 'rgba(255,255,255,0.4)' : 'rgba(70,60,130,0.68)',
      kinds: {
        ib: K(S(cBg, chrome, cRing, fg), S(cBg, chromeH, cRing, chromeInk), S(cBg, chromeP, cPress, ink, 'scale(0.95)')),
        add: K(S(cBg, chrome, cRing, fg), S(cBg, chromeH, cRing, chromeInk), S(cBg, chromeP, cPress, ink, 'scale(0.95)')),
        btn: K(S(cBg, chrome, cRing, fg), S(cBg, chromeH, cRing, chromeInk), S(cBg, chromeP, cPress, ink, 'scale(0.96)')),
        primary: K(
          S(paint, gel, gelSh, '#FFFFFF'),
          S(mix(paint, '#ffffff', 0.04), gel, gelSh + ', 0 0 16px ' + rgba(AL, 0.45), '#FFFFFF'),
          S(mix(paint, '#000000', 0.1), gelP, 'inset 0 0 0 1px ' + mix(AL, '#000000', 0.35) + ', inset 0 2px 5px rgba(0,0,0,0.3)', '#FFFFFF', 'scale(0.96)'),
        ),
        step: K(S('rgba(0,0,0,0)', 0, 0, fg), S(rgba(A, 0.14), 0, 0, chromeInk), S(rgba(A, dark ? 0.24 : 0.16), 0, cPress, chromeInk, 'scale(0.94)')),
        ghost: K(S('rgba(0,0,0,0)', 0, 0, muted), S(rgba(A, 0.12), 0, 0, ghostInk), S(rgba(A, 0.2), 0, 0, ghostInk)),
      },
      ghostSel: K(
        S('rgba(0,0,0,0)', 0, 0, muted),
        S(dark ? 'rgba(11,13,38,0.15)' : 'rgba(255,255,255,0.45)', 0, 0, ink),
        S(dark ? 'rgba(11,13,38,0.25)' : 'rgba(255,255,255,0.7)', 0, 0, ink),
      ),
    },
    mode,
  )
}
