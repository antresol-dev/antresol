import { openDeviceDb } from '~/lib/device-db'
import { createDemoDriver } from '~/lib/dev/demo-source'
import { createNeonDriver } from '~/lib/sources'
import { createWorkspace } from '~/lib/workspace'

const STALE_AFTER_MS = 15 * 60_000

export default defineNuxtPlugin(async () => {
  const isDev = import.meta.dev
  const workspace = createWorkspace({
    db: await openDeviceDb(),
    drivers: { neon: createNeonDriver(), ...(isDev ? { 'dev-pglite': createDemoDriver() } : {}) },
    userAgent: navigator.userAgent,
  })

  // Source failures are recorded in workspace.state; nothing else to do with a rejected refresh here.
  const quietly = (job: Promise<void>): void => void job.catch(() => {})

  const ready = workspace.startFromCache()
  quietly(ready.then(() => workspace.refresh()))

  window.addEventListener('online', () => quietly(workspace.refresh()))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') quietly(workspace.refreshIfStale(STALE_AFTER_MS))
  })

  return { provide: { workspace, workspaceReady: ready } }
})
