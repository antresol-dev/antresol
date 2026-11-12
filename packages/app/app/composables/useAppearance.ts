import type { Appearance } from '~/lib/appearance'

/** The device's style and accent (plugins/appearance.client.ts). */
export function useAppearance(): Appearance {
  return useNuxtApp().$appearance
}
