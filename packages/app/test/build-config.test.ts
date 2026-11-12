import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)

async function loadConfig(baseUrl?: string) {
  vi.resetModules()
  if (baseUrl === undefined) delete process.env.NUXT_APP_BASE_URL
  else vi.stubEnv('NUXT_APP_BASE_URL', baseUrl)
  return (await import('../nuxt.config')).default
}

afterEach(() => vi.unstubAllEnvs())

describe('production build config', () => {
  it('serves from the root by default', async () => {
    expect((await loadConfig()).app?.baseURL).toBe('/')
  })

  it('takes the base path from NUXT_APP_BASE_URL (GitHub Pages project site)', async () => {
    expect((await loadConfig('/antresol/')).app?.baseURL).toBe('/antresol/')
  })

  it('falls back to the app shell precached under the base URL for navigations', async () => {
    expect((await loadConfig()).pwa?.workbox?.navigateFallback).toBe('/')
    const workbox = (await loadConfig('/antresol/')).pwa?.workbox
    expect(workbox?.navigateFallback).toBe('/antresol/')
    expect(workbox?.navigateFallbackDenylist?.some((re: RegExp) => re.test('/antresol/_nuxt/a.js'))).toBe(true)
  })

  it('keeps the manifest relative so it follows the base path', async () => {
    const manifest = (await loadConfig()).pwa?.manifest
    expect(manifest && 'start_url' in manifest ? manifest.start_url : undefined).toBe('.')
    expect(manifest && 'scope' in manifest ? manifest.scope : undefined).toBe('.')
  })
})
