import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STYLE, STYLES } from '../app/lib/styles/registry'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
const { default: config } = await import('../nuxt.config')

describe('nuxt config', () => {
  // Android Chrome's default (resizes-visual) leaves the layout viewport full height under the
  // on-screen keyboard, so bottom-anchored sheets end up hidden behind it.
  it('lets the on-screen keyboard shrink the layout so bottom sheets stay above it', () => {
    expect(config.app?.head?.viewport).toContain('interactive-widget=resizes-content')
  })

  // Edge to edge: the page draws under Android's navigation bar, so the bar shows the page (the dock) in every theme
  // instead of a fixed light strip; bottom bars pad themselves with env(safe-area-inset-bottom).
  it('draws under the system navigation bar', () => {
    expect(config.app?.head?.viewport).toContain('viewport-fit=cover')
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

  it('paints the splash and title bar in the default style\'s light page colour', () => {
    const manifest = config.pwa?.manifest
    const { build, defaultAccent } = STYLES[DEFAULT_STYLE]
    const page = build('light', defaultAccent).pageColor
    expect(page).toBe('#F4F5F7')
    expect(manifest && [manifest.background_color, manifest.theme_color]).toEqual([page, page])
  })

  it('loads Manrope 800 (font-extrabold)', () => {
    expect(config.fonts?.families?.find(f => f.name === 'Manrope')).toMatchObject({ name: 'Manrope', weights: [400, 500, 600, 700, 800] })
  })
})
