import { computed, readonly, ref, type Ref } from 'vue'
import { isAccentName, type AccentName } from './accent'
import type { DeviceDb } from './device-db'
import { applyStyle } from './styles/apply'
import { DEFAULT_STYLE, effectiveAccent, isStyleName } from './styles/registry'
import type { StyleName } from './styles/types'

/*
 * The device's appearance (spec 2026-11-12 styles §4, §6): the style and the accent, kept in the device settings and
 * put on <html> before the app mounts (plugins/appearance.client.ts), so the first frame is already in the stored
 * style. A value this app does not know (written by a newer one) counts as not set and stays stored for that app.
 */

export interface Appearance {
  readonly style: Readonly<Ref<StyleName>>
  /** The chosen accent; null = "Style default". */
  readonly accent: Readonly<Ref<AccentName | null>>
  /** The accent the style is drawn with: a fixed palette's own; otherwise `accent` ?? the style's default. */
  readonly effectiveAccent: Readonly<Ref<AccentName>>
  /** Applies the stored style and accent. Never rejects: on a failing store the defaults stay. */
  load(): Promise<void>
  /** Applies the style at once, then saves it (rejects if saving fails; the style stays applied). */
  setStyle(name: StyleName): Promise<void>
  /** Applies the accent at once (null: the style's default), then saves it (rejects if saving fails). */
  setAccent(name: AccentName | null): Promise<void>
}

export function createAppearance(db: Pick<DeviceDb, 'getSettings' | 'putSettings'>, root: HTMLElement): Appearance {
  const style = ref<StyleName>(DEFAULT_STYLE)
  const accent = ref<AccentName | null>(null)
  const effective = computed(() => effectiveAccent(style.value, accent.value))
  const show = (): void => {
    try {
      applyStyle(root, style.value, effective.value)
    } catch {
      // A style that cannot be drawn (a bad token) must not keep the app from starting: the default style instead.
      // The stored choice stays as it is.
      if (style.value === DEFAULT_STYLE) return
      style.value = DEFAULT_STYLE
      show()
    }
  }
  return {
    style: readonly(style),
    accent: readonly(accent),
    effectiveAccent: effective,
    async load() {
      let stored: { style?: unknown; accent?: unknown }
      try {
        stored = await db.getSettings()
      } catch {
        stored = {}
      }
      style.value = isStyleName(stored.style) ? stored.style : DEFAULT_STYLE
      accent.value = isAccentName(stored.accent) ? stored.accent : null
      show()
    },
    async setStyle(name) {
      style.value = name
      show()
      await db.putSettings({ style: name })
    },
    async setAccent(name) {
      accent.value = name
      show()
      // undefined, not null: an absent accent is "not chosen" (DeviceSettings.accent).
      await db.putSettings({ accent: name ?? undefined })
    },
  }
}
