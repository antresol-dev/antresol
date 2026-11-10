import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
const { default: config } = await import('../nuxt.config')

describe('nuxt config', () => {
  // Android Chrome's default (resizes-visual) leaves the layout viewport full height under the
  // on-screen keyboard, so bottom-anchored sheets end up hidden behind it.
  it('lets the on-screen keyboard shrink the layout so bottom sheets stay above it', () => {
    expect(config.app?.head?.viewport).toBe('width=device-width, initial-scale=1, interactive-widget=resizes-content')
  })
})
