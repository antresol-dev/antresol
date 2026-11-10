import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
const { default: config } = await import('../nuxt.config')

describe('nuxt config', () => {
  // Android Chrome's default (resizes-visual) leaves the layout viewport full height under the
  // on-screen keyboard, so bottom-anchored sheets end up hidden behind it.
  it('lets the on-screen keyboard shrink the layout so bottom sheets stay above it', () => {
    expect(config.app?.head?.viewport).toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content')
  })

  it('asks before updating the service worker', () => {
    expect(config.pwa?.registerType).toBe('prompt')
  })

  it('offers Add item and Search as app shortcuts, relative to the base path', () => {
    const shortcuts = config.pwa?.manifest && config.pwa.manifest.shortcuts
    expect(shortcuts?.map((s) => [s.name, s.url])).toEqual([
      ['Add item', './?action=add'],
      ['Search', './?action=search'],
    ])
  })

  it('loads Manrope 800 (font-extrabold)', () => {
    expect(config.fonts?.families?.[0]).toMatchObject({ name: 'Manrope', weights: [400, 500, 600, 700, 800] })
  })

  it('declares light and dark theme-color metas matching the background tokens', () => {
    const meta = config.app?.head?.meta ?? []
    expect(meta).toContainEqual({ name: 'theme-color', content: '#F7F7F8', media: '(prefers-color-scheme: light)' })
    expect(meta).toContainEqual({ name: 'theme-color', content: '#0E0E10', media: '(prefers-color-scheme: dark)' })
  })
})
