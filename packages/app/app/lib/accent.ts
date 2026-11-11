import { readonly, ref, type Ref } from 'vue'
import type { DeviceDb } from './device-db'

/*
 * The accent colour (spec 2026-11-11 §4.1, 2026-11-12 §A): chosen in Settings → Appearance, kept in the device settings,
 * applied on <html> before the app mounts (plugins/accent.client.ts). main.css takes --accent from --accent-light in the
 * light theme and from --accent-dark in the dark one; everything accent-coloured derives from them.
 */

export type AccentName = 'indigo' | 'violet' | 'blue' | 'sky' | 'teal' | 'green' | 'orange' | 'rose' | 'pink' | 'slate'

/**
 * Only colours that carry white text at 4.5:1 or better when painted (after Nuxt UI's palette). `light` is the accent
 * of the light theme and the paint of the dark theme's accent button. `dark` is the dark theme's accent (board 8 of the
 * owner's mock-up), mix(light, white, 0.12): the hue of its tints, gradients and fills; the dark theme's
 * accent-coloured text is mix(light, white, 0.5) (test/accent.test.ts, test/style.test.ts).
 */
export const ACCENTS: Record<AccentName, { light: string; dark: string }> = {
  indigo: { light: '#4F46E5', dark: '#645CE8' },
  violet: { light: '#7C3AED', dark: '#8C52EF' },
  blue: { light: '#2563EB', dark: '#3F76ED' },
  sky: { light: '#0369A1', dark: '#217BAC' },
  teal: { light: '#0F766E', dark: '#2C867F' },
  green: { light: '#15803D', dark: '#318F54' },
  orange: { light: '#C2410C', dark: '#C95829' },
  rose: { light: '#BE123C', dark: '#C62E53' },
  pink: { light: '#BE185D', dark: '#C63470' },
  slate: { light: '#475569', dark: '#5D697B' },
}

export const ACCENT_NAMES = Object.keys(ACCENTS) as AccentName[]

export const DEFAULT_ACCENT: AccentName = 'indigo'

export function isAccentName(v: unknown): v is AccentName {
  return typeof v === 'string' && Object.hasOwn(ACCENTS, v)
}

/** Writes both theme variants on `root` (normally <html>); the stylesheet picks the one of the current theme. */
export function applyAccent(name: AccentName, root: HTMLElement): void {
  root.style.setProperty('--accent-light', ACCENTS[name].light)
  root.style.setProperty('--accent-dark', ACCENTS[name].dark)
}

export interface Accent {
  readonly current: Readonly<Ref<AccentName>>
  /** Applies the device's stored accent. Never rejects: on a failing store the default stays. */
  load(): Promise<void>
  /** Applies `name` at once, then saves it on the device (rejects if saving fails; the colour stays applied). */
  set(name: AccentName): Promise<void>
}

export function createAccent(db: Pick<DeviceDb, 'getSettings' | 'putSettings'>, root: HTMLElement): Accent {
  const current = ref<AccentName>(DEFAULT_ACCENT)
  const show = (name: AccentName) => {
    current.value = name
    applyAccent(name, root)
  }
  return {
    current: readonly(current),
    async load() {
      let stored: unknown
      try {
        stored = (await db.getSettings()).accent
      } catch {
        stored = undefined
      }
      // An unknown value (written by a newer app) counts as not set; it stays stored for that app.
      show(isAccentName(stored) ? stored : DEFAULT_ACCENT)
    },
    async set(name) {
      show(name)
      await db.putSettings({ accent: name })
    },
  }
}
