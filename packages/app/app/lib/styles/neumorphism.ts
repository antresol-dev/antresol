import { ACCENTS } from '../accent'
import { mix, rgba } from './color'
import { K, MOCKUP_DEFAULTS, S, finish } from './derive'
import type { Kind, StyleBuild } from './types'

/*
 * S2 Neumorphism: "Hybrid v2" — the owner's boards 7 (light: depth 0.7, light 1.1, shade 0.7, soft accent button) and
 * 8 (dark: base #2A2E37, depth 0.8, light 0.7, shade 0.9, painted accent button, a 1 px rim). The mock-up's
 * `neumorphism` branch, with the values the app settled on after the owner's reviews where they differ (spec §5:
 * Neumorphism looks exactly as before styles; test/styles.test.ts compares every value with main.css as it was):
 *  - the dark accent is the light one lifted by 12 % white (not the mock-up's pastel), accent text half-way to white;
 *  - hover tints raised controls 7 % and press 12 % (the mock-up's btn: 6 / 11 %); no "down" gradient on press;
 *  - the soft accent button keeps its hover tint when pressed (the mock-up's 24 % fails accent-ink on blue, green,
 *    orange); dark: painted in the accent itself (the 12 % lift takes white text under 4.5:1), darkening on hover;
 *  - flat controls and the selected row tint 24 % at most on dark (the mock-up's 26 % fails rose);
 *  - the stepper on a selected row lights up white on hover and sinks deeper into the accent;
 *  - menus: a real 1 px border for the rim; dark: hovered items keep the text colour, muted text lighter;
 *  - shadow and sink share one duration and curve: 160 ms cubic-bezier(0.4, 0, 0.2, 1) (the mock-up: 200 ms ease-out);
 *  - radii: every control and tile 14, photo 20, small things 10; the header's line is its 1 px border;
 *  - the font stack keeps @nuxt/fonts' metric-matched fallbacks for Manrope; plain button labels 500 (emphasised 700).
 */

const ZERO = '0px 0px 0px transparent, 0px 0px 0px transparent'
const ZERO_INSET = 'inset 0px 0px 0px transparent, inset 0px 0px 0px transparent'
const FLAT = `${ZERO}, ${ZERO_INSET}`
/** The body font as the app drew it: @nuxt/fonts' rewrite of the mock-up's 'Manrope', system-ui, sans-serif with its
 *  metric-matched local fallbacks (they draw the glyphs Manrope lacks, such as →, and the text before it loads). The
 *  fallback faces exist because main.css names Manrope literally (its boot font); without them the stack is the
 *  mock-up's. */
const MANROPE = `'Manrope', ${['Segoe UI', 'Helvetica Neue', 'Arial', 'Noto Sans', 'Liberation Sans'].map((f) => `"Manrope Fallback: ${f}"`).join(', ')}, system-ui, sans-serif`
/** Tailwind's shadow-lg, which sheets had. */
const SHADOW_LG = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'

export const build: StyleBuild = (mode, accent) => {
  const dark = mode === 'dark'
  const AL = ACCENTS[accent].light
  /** The accent for tints, gradients and fills. */
  const A = dark ? mix(AL, '#ffffff', 0.12) : AL
  const B = dark ? '#2A2E37' : '#EDEFF3'
  const ink = dark ? mix(AL, '#ffffff', 0.5) : mix(AL, '#000000', 0.18)
  const fg = dark ? '#E6E8EE' : '#1C2030'
  const muted = dark ? '#A3A9B6' : '#565D6E'
  const icon = dark ? '#D2D6DE' : '#2F3442'
  const border = dark ? '#363B46' : '#D9DDE5'
  const tint = (x: number) => mix(B, A, x)

  // The mock-up's hybrid sh(): shadow lists at this theme's depth, light and shade. Outer and inset pairs are always
  // both listed (the unused one at zero), so raised ↔ pressed animates instead of jumping.
  const depth = dark ? 0.8 : 0.7
  const light = dark ? 0.7 : 1.1
  const shade = dark ? 0.9 : 0.7
  const n = (v: number) => Math.round(v * depth * 10) / 10
  const DK = dark ? 'rgba(6, 8, 12, 0.56)' : 'rgba(150, 160, 180, 0.29)'
  const LT = dark ? 'rgba(255, 255, 255, 0.049)' : 'rgba(255, 255, 255, 0.88)'
  /** Dark: the raised state's spare inset slot is a 1 px top-left rim, the edge catching the light. */
  const REST = dark ? `inset ${n(1)}px ${n(1)}px 0px rgba(255, 255, 255, 0.042), inset 0px 0px 0px transparent` : ZERO_INSET
  /** DKa(k): the accent's shade at k·shade (dark: k·1.5·shade). */
  const shadeOf = (paint: string) => (dark ? mix(paint, '#000000', 0.8) : mix(paint, '#1C2030', 0.45))
  const DKa = (k: number, paint = AL) => rgba(shadeOf(paint), Math.min(1, k * (dark ? 1.5 : 1) * shade))
  const pair = (x: number, b: number, dk: string, lt: string, inset = '') => {
    const xd = n(x * (0.55 + 0.45 * shade))
    const bd = n(b * (0.6 + 0.4 * shade))
    const xl = n(x * light)
    const bl = n(b * light)
    return `${inset}${xd}px ${xd}px ${bd}px ${dk}, ${inset}${-xl}px ${-xl}px ${bl}px ${lt}`
  }
  /** Raised: R(x, b). */
  const R = (x: number, b: number, dk = DK) => `${pair(x, b, dk, LT)}, ${REST}`
  /** Sunk: I(x, b). */
  const I = (x: number, b: number, dk: string, lt = LT) => `${ZERO}, ${pair(x, b, dk, lt, 'inset ')}`

  /** A painted surface (the dark accent button, the destructive button): R(4,10) in the paint's shade and a thin
   *  bevel; pressed I(3,7) in its deep shade. It darkens on hover (lightening takes white text under 4.5:1) — the
   *  dark destructive paint is light with dark text and lightens instead. */
  const painted = (paint: string, text: string, toward: string): Kind => {
    const deep = mix(paint, '#000000', 0.45)
    const bevel = dark
      ? `inset 0.8px 0.8px 1.2px rgba(255, 255, 255, 0.3), inset -0.8px -0.8px 1.6px ${rgba(deep, 0.3)}`
      : `inset 0.7px 0.7px 1px rgba(255, 255, 255, 0.3), inset -0.7px -0.7px 1.4px ${rgba(deep, 0.3)}`
    const up = `${R(4, 10, DKa(0.55, paint))}, ${bevel}`
    const down = `${I(3, 7, rgba(deep, 0.55), 'rgba(255, 255, 255, 0.22)')}, ${ZERO_INSET}`
    return K(S(paint, 0, up, text), S(mix(paint, toward, 0.08), 0, up, text), S(mix(paint, '#000000', 0.1), 0, down, text, 'scale(0.985)'))
  }
  const destructive = dark ? '#F87171' : '#B91C1C'
  const destructiveFg = dark ? '#16181D' : '#FFFFFF'
  const hv = dark ? 0.16 : 0.08

  return finish(
    {
      ...MOCKUP_DEFAULTS,
      font: MANROPE,
      headFont: MANROPE,
      labelFont: MANROPE,
      page: B,
      fg,
      muted,
      subtle: muted,
      icon,
      dimmed: dark ? '#BFC4CE' : '#474D5A',
      ink,
      hdr: B,
      hdrSh: 'none',
      photo: dark ? '#323743' : '#E2E5EB',
      photoSh: 'none',
      photoR: '20px',
      photoFg: muted,
      thumbs: [dark ? '#323743' : '#E2E5EB'],
      thumbFg: muted,
      thumbSh: 'none',
      thumbR: '14px',
      chips: [dark ? '#373C48' : '#DDE1E8'],
      chipFgs: [fg],
      chipSh: 'none',
      chipR: '999px',
      card: B,
      cardSh: R(6, 14),
      cardR: '20px',
      cardFg: fg,
      cardMuted: muted,
      list: 'transparent',
      listSh: 'none',
      listR: '0',
      divider: `1px solid ${border}`,
      cur: `linear-gradient(90deg, ${rgba(A, dark ? 0.24 : 0.17)}, ${rgba(A, dark ? 0.12 : 0.08)})`,
      curSh: 'none',
      curR: '14px',
      curM: '0',
      curFg: ink,
      // Lighter than muted on dark: muted text on the selected row stays at 4.5:1.
      curMuted: dark ? '#B4B9C4' : '#4B5263',
      pillBg: B,
      pillImg: 'none',
      pillSh: R(3, 8),
      pillR: '14px',
      seam: `1px solid ${dark ? 'rgba(0, 0, 0, 0.28)' : 'rgba(150, 160, 180, 0.22)'}`,
      pillSelBg: tint(dark ? 0.12 : 0.08),
      pillSelSh: R(3, 8, DKa(0.5)),
      ibR: '14px',
      btnR: '14px',
      primR: '14px',
      ghostR: '14px',
      pop: dark
        ? 'linear-gradient(165deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.05) 100%), rgba(44, 48, 58, 0.48)'
        : 'linear-gradient(165deg, rgba(255, 255, 255, 0.6) 0%, rgba(255, 255, 255, 0.12) 38%, rgba(255, 255, 255, 0) 62%, rgba(255, 255, 255, 0.18) 100%), rgba(255, 255, 255, 0.38)',
      popBlur: dark ? 'blur(16px) saturate(160%)' : 'blur(14px) saturate(180%)',
      popSh: dark
        ? '0 20px 44px -12px rgba(0, 0, 0, 0.6), 0 4px 12px -4px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 1px rgba(255, 255, 255, 0.04)'
        : '0 18px 40px -14px rgba(28, 32, 48, 0.35), 0 4px 12px -4px rgba(28, 32, 48, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.95), inset 0 -1px 1px rgba(255, 255, 255, 0.3), inset 1px 0 0 rgba(255, 255, 255, 0.35)',
      popR: '20px',
      popFg: fg,
      popHover: dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.55)',
      // Dark: accent-ink on a hovered item is under 4.5:1 on several accents (the white highlight lifts the pane).
      popHoverFg: dark ? fg : ink,
      popDanger: dark ? '#FCA5A5' : '#B91C1C',
      popDiv: dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(28, 32, 48, 0.1)',
      popItemR: '14px',
      tr: 'background-color 180ms ease, color 180ms ease, box-shadow 160ms cubic-bezier(0.4, 0, 0.2, 1), transform 160ms cubic-bezier(0.4, 0, 0.2, 1)',
      kinds: {
        ib: K(S(B, 0, R(3, 7), icon), S(tint(0.07), 0, R(3, 7, DKa(0.3)), ink), S(tint(0.12), 0, I(2.5, 6, DKa(0.42)), ink, 'scale(0.97)')),
        add: K(S(B, 0, R(3, 7), icon), S(tint(0.07), 0, R(3, 7, DKa(0.3)), ink), S(tint(0.12), 0, I(2.5, 6, DKa(0.42)), ink, 'scale(0.97)')),
        btn: K(S(B, 0, R(4, 10), fg), S(tint(0.07), 0, R(4, 10, DKa(0.3)), ink), S(tint(0.12), 0, I(3, 7, DKa(0.42)), ink, 'scale(0.985)')),
        primary: dark
          ? painted(AL, '#FFFFFF', '#000000')
          : K(S(tint(0.14), 0, R(4, 10, DKa(0.45)), ink), S(tint(0.2), 0, R(4, 10, DKa(0.5)), ink), S(tint(0.2), 0, I(3, 7, DKa(0.55)), ink, 'scale(0.985)')),
        step: K(S('transparent', 0, FLAT, icon), S(rgba(A, hv), 0, FLAT, ink), S(tint(0.12), 0, I(2, 5, DKa(0.42)), ink)),
        ghost: K(S('transparent', 0, 0, muted), S(rgba(A, hv), 0, 0, ink), S(rgba(A, dark ? 0.24 : 0.16), 0, 0, ink)),
      },
      // The mock-up's white 7 % under accent-ink is under 4.5:1 on rose and pink: on dark the hovered half lights its
      // text up to the foreground instead.
      stepSel: K(
        S('transparent', 0, FLAT, ink),
        S(dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.45)', 0, FLAT, dark ? fg : ink),
        S(tint(0.18), 0, I(2, 5, DKa(0.55)), ink),
      ),

      // App surfaces as the app had them.
      pageColor: B,
      accent: A,
      accentSoft: tint(0.12),
      accentSoftFg: ink,
      primary: dark ? ink : AL,
      primaryFg: dark ? '#16181D' : '#FFFFFF',
      ring: dark ? ink : AL,
      painted: painted(AL, '#FFFFFF', '#000000'),
      paintedDanger: painted(destructive, destructiveFg, dark ? '#FFFFFF' : '#000000'),
      destructive,
      destructiveFg,
      warning: dark ? '#FBBF24' : '#92400E',
      rowHover: tint(0.07),
      chip: dark ? '#373C48' : '#DDE1E8',
      thumb: dark ? '#323743' : '#E2E5EB',
      surface: B,
      rail: dark ? '#252931' : '#E4E7ED',
      border,
      dividerColor: border,
      treeLine: dark ? '#414653' : '#CDD2DB',
      hdrLine: border,
      field: dark ? '#24272F' : '#F6F7F9',
      fieldLine: dark ? 'rgba(255, 255, 255, 0.12)' : '#CDD2DB',
      fieldSh: 'none',
      sheet: B,
      sheetSh: SHADOW_LG,
      sheetLine: border,
      sheetBlur: 'none',
      overlay: 'rgba(0, 0, 0, 0.8)',
      popSolid: B,
      popBorder: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.65)',
      popMuted: dark ? '#B4B9C4' : muted,
      // Tooltips are inverted: the page's colour on the text colour.
      tip: fg,
      tipFg: B,
      tipSh: 'none',
      smallR: '10px',
      // Buttons the markup does not emphasise were font-medium; the emphasised actions bold (btnWeight's 700).
      plainBtnWeight: '500',
    },
    mode,
  )
}
