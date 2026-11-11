import { createAccent } from '~/lib/accent'
import { openDeviceDb } from '~/lib/device-db'

// The device's accent is on <html> before the app mounts, so the first frame already has it (no flash of indigo).
// Parallel: the device-settings read overlaps the other plugins instead of delaying them.
export default defineNuxtPlugin({
  name: 'accent',
  parallel: true,
  async setup() {
    const accent = createAccent(await openDeviceDb(), document.documentElement)
    await accent.load()
    return { provide: { accent } }
  },
})
