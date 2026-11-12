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

  it('is a share target: GET to the share route, relative to the base path, with title, text and url', () => {
    const manifest = config.pwa?.manifest
    expect(manifest && 'share_target' in manifest ? manifest.share_target : undefined).toEqual({
      action: './share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    })
  })

  it('paints the splash and title bar in the Hybrid v2 background', () => {
    const manifest = config.pwa?.manifest
    expect(manifest && [manifest.background_color, manifest.theme_color]).toEqual(['#EDEFF3', '#EDEFF3'])
  })

  it('loads Manrope 800 (font-extrabold)', () => {
    expect(config.fonts?.families?.find(f => f.name === 'Manrope')).toMatchObject({ name: 'Manrope', weights: [400, 500, 600, 700, 800] })
  })
})
