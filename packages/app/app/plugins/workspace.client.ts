import { openDeviceDb } from '~/lib/device-db'
import { createNeonDriver } from '~/lib/sources'
import { createWorkspace } from '~/lib/workspace'
import type { WorkspaceDeps } from '~/lib/workspace-types'

/** A flapping connection fires `online` repeatedly; one reload per window is enough. */
const ONLINE_DEBOUNCE_MS = 2_000

export default defineNuxtPlugin(async () => {
  const drivers: WorkspaceDeps['drivers'] = { neon: createNeonDriver() }
  // No dev-pglite driver in production: a demo source saved on the device shows as unavailable (unsupported_source).
  // A plain `if` on purpose: inside a spread expression `import.meta.dev` was left unreplaced in dev, so the demo
  // driver never registered there. The dynamic import keeps PGlite out of the production bundle.
  if (import.meta.dev) {
    const { createDemoDriver } = await import('~/lib/dev/demo-source')
    drivers['dev-pglite'] = createDemoDriver()
  }
  const workspace = createWorkspace({
    db: await openDeviceDb(),
    drivers,
    userAgent: navigator.userAgent,
    // A source needs a newer app: look for one now. A new version found here waits behind UpdatePrompt's toast.
    checkForUpdate: () => void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => {}),
  })

  // Source failures are recorded in workspace.state; nothing else to do with a rejected refresh here.
  const quietly = (job: Promise<void>): void => void job.catch(() => {})

  const ready = workspace.startFromCache()
  quietly(ready.then(() => workspace.refresh()))

  let onlineTimer: ReturnType<typeof setTimeout> | undefined
  window.addEventListener('online', () => {
    clearTimeout(onlineTimer)
    onlineTimer = setTimeout(() => quietly(workspace.refresh()), ONLINE_DEBOUNCE_MS)
  })
  document.addEventListener('visibilitychange', () => {
    // Back in the app: a check if the device's interval has passed (or a source is failing).
    if (document.visibilityState === 'visible') quietly(workspace.syncIfDue())
    // The app may be closed while hidden: written rows not saved on the device yet are saved now.
    if (document.visibilityState === 'hidden') quietly(workspace.flushCache())
  })

  return { provide: { workspace, workspaceReady: ready } }
})
