import type { Accent } from '~/lib/accent'

/** The device's accent colour (plugins/accent.client.ts). */
export function useAccent(): Accent {
  return useNuxtApp().$accent
}
