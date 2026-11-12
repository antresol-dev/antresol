/*
 * The accent colours (spec 2026-11-12 styles §4): the owner's mock-up's ACC table. Chosen in Settings → Appearance
 * (or "Style default"), kept in the device settings and applied with the style (lib/appearance.ts): each style's
 * build() turns the accent into its own colours (lib/styles/).
 */

export type AccentName = 'indigo' | 'violet' | 'blue' | 'sky' | 'teal' | 'green' | 'orange' | 'rose' | 'pink' | 'slate' | 'copper'

/**
 * The mock-up's ACC: `light` is the accent of the light themes (it carries white text at 4.5:1 when painted), `dark` the
 * pastel the styles use on dark themes. Neumorphism (lib/styles/neumorphism.ts) keeps its own dark rule — the light
 * colour lifted by 12 % white — as the app had it before styles.
 */
export const ACCENTS: Record<AccentName, { light: string; dark: string }> = {
  indigo: { light: '#4F46E5', dark: '#B0ACF3' },
  violet: { light: '#7C3AED', dark: '#C4A6F7' },
  blue: { light: '#2563EB', dark: '#9DB9F6' },
  sky: { light: '#0369A1', dark: '#8EBCD5' },
  teal: { light: '#0F766E', dark: '#93C1BE' },
  green: { light: '#15803D', dark: '#96C6A8' },
  orange: { light: '#C2410C', dark: '#E4AA92' },
  rose: { light: '#BE123C', dark: '#E294A7' },
  pink: { light: '#BE185D', dark: '#E297B6' },
  slate: { light: '#475569', dark: '#ACB3BC' },
  copper: { light: '#9A4F1E', dark: '#E0A273' },
}

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[]

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === 'string' && Object.hasOwn(ACCENTS, v)
}
