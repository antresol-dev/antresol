import { createAppearance, type Appearance } from '~/lib/appearance'
import { openDeviceDb } from '~/lib/device-db'

declare global {
  interface Window {
    /** Dev builds only: switch the look from the console before the settings screen can, e.g.
     *  `await __gmAppearance.setStyle('retro')`, `await __gmAppearance.setAccent('rose')` (null: "Style default"). */
    __gmAppearance?: Appearance
  }
}

// The device's style and accent are on <html> before the app mounts (Nuxt awaits every plugin's setup, parallel ones
// included), so the first frame is already in the stored style: no flash of another one (Review Focus 2). Parallel: the
// device-settings read overlaps the other plugins instead of delaying them.
export default defineNuxtPlugin({
  name: 'appearance',
  parallel: true,
  async setup() {
    const appearance = createAppearance(await openDeviceDb(), document.documentElement)
    await appearance.load()
    if (import.meta.dev) window.__gmAppearance = appearance
    return { provide: { appearance } }
  },
})
