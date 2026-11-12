import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { INVENTORY_KEY } from '../app/lib/history-nav'
import type { InventoryRef } from '../app/lib/types'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('vue-sonner', () => ({ toast: { error: toastError } }))
vi.mock('~/lib/errors', () => import('../app/lib/errors'))
vi.mock('~/lib/history-nav', () => import('../app/lib/history-nav'))
vi.mock('~/lib/shell', () => import('../app/lib/shell'))

type Route = { fullPath: string; name: string }
type AfterEach = (to: Route, from: Route, failure?: unknown) => Promise<void>
type Setup = (nuxtApp: unknown) => void

let setup: Setup
beforeAll(async () => {
  // Nuxt auto-imports, as globals for the plugin module.
  vi.stubGlobal('defineNuxtPlugin', (fn: Setup) => fn)
  vi.stubGlobal('useRouter', () => router)
  setup = (await import('../app/plugins/history-sync.client')).default as unknown as Setup
})
afterEach(() => {
  toastError.mockReset()
})

let router: {
  afterEach: (hook: AfterEach) => void
  currentRoute: { value: { fullPath: string } }
  replace: ReturnType<typeof vi.fn>
}

const A: InventoryRef = { sourceId: 's1', inventoryId: 'a' }
const folder: Route = { fullPath: '/folder/f1', name: 'folder-id' }

/** Installs the plugin and returns its afterEach hook; `ready` stands for $workspaceReady. */
function install(ready: () => Promise<void>, entry: InventoryRef | null): AfterEach {
  let hook: AfterEach | undefined
  router = {
    afterEach: (fn) => (hook = fn),
    currentRoute: { value: { fullPath: folder.fullPath } },
    replace: vi.fn(),
  }
  vi.stubGlobal('window', { history: { state: entry ? { [INVENTORY_KEY]: entry } : {}, replaceState: vi.fn() } })
  setup({
    get $workspaceReady() {
      return ready()
    },
    $workspace: { state: { current: A, inventories: [{ ref: A }] }, selectInventory: vi.fn() },
    $i18n: { t: (key: string) => `t:${key}` },
  })
  return hook!
}

describe('history sync plugin', () => {
  it('reports a rejected workspace start instead of an unhandled rejection', async () => {
    const hook = install(() => Promise.reject(new Error('device storage pw-secret')), null)
    await expect(hook(folder, folder)).resolves.toBeUndefined()
    expect(toastError).toHaveBeenCalledWith('t:errors.unknown')
  })

  it('reports a rejected workspace start once, not again on every navigation after it', async () => {
    const hook = install(() => Promise.reject(new Error('device storage')), null)
    await hook(folder, folder)
    await hook(folder, folder)
    await hook(folder, folder)
    expect(toastError).toHaveBeenCalledTimes(1)
  })

  it('reports a rejected replace onto the current root instead of an unhandled rejection', async () => {
    const hook = install(() => Promise.resolve(), { sourceId: 's1', inventoryId: 'gone' })
    router.replace.mockRejectedValue(new Error('navigation failed'))
    await expect(hook(folder, folder)).resolves.toBeUndefined()
    expect(router.replace).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith('t:errors.unknown')
  })
})
