import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { ACCENT_NAMES, ACCENTS } from '../app/lib/accent'
import { cspFor } from '../app/lib/csp'
import { faviconHref, logoColor, logoSvg } from '../app/lib/brand'

describe('logo colour', () => {
  it('is the accent\'s saturated (light) value for every accent, in both themes', () => {
    for (const a of ACCENT_NAMES) expect(logoColor(a)).toBe(ACCENTS[a].light)
  })
})

describe('tab icon', () => {
  it('builds the icon geometry with the tile and pulls in the colour and white doors', () => {
    const svg = logoSvg('#0F766E')
    expect(svg.match(/#0F766E/g)).toHaveLength(2)
    expect(svg.match(/#FFFFFF/g)).toHaveLength(1)
    expect(svg).toContain('width="35" height="44"')
  })

  it('is a data URL the CSP\'s img-src allows', () => {
    const href = faviconHref('#4F46E5')
    expect(href.startsWith('data:image/svg+xml,')).toBe(true)
    expect(decodeURIComponent(href.slice('data:image/svg+xml,'.length))).toBe(logoSvg('#4F46E5'))
    expect(cspFor([])).toMatch(/img-src [^;]*\bdata:/)
  })

  it('matches the shipped static icon\'s geometry', () => {
    const file = readFileSync(fileURLToPath(new URL('../public/favicon.svg', import.meta.url)), 'utf8')
    const shapes = (s: string) => [...s.matchAll(/<rect[^>]*>/g)].map(m => m[0].replace(/\s*\/?>$/, '').replace(/ fill="[^"]*"/, ''))
    expect(shapes(logoSvg('#17181C'))).toEqual(shapes(file))
    expect(file).not.toMatch(/c2pa|metadata|<\?xml/i)
  })
})

describe('product name', () => {
  it('is Antresol in the strings, with no GrayMatter left for users to see', () => {
    const en = readFileSync(fileURLToPath(new URL('../i18n/locales/en.json', import.meta.url)), 'utf8')
    expect(JSON.parse(en).app.name).toBe('Antresol')
    expect(en).not.toMatch(/GrayMatter/i)
  })

  it('is Antresol in the manifest and the page title', async () => {
    vi.stubGlobal('defineNuxtConfig', <T>(c: T) => c)
    const config = (await import('../nuxt.config')).default
    expect(config.pwa?.manifest).toMatchObject({ name: 'Antresol', short_name: 'Antresol' })
    expect(config.app?.head?.title).toBe('Antresol')
  })
})

describe('installed icons', () => {
  it('are painted on the owner\'s #17181C (maskable and Apple), not the preset\'s white', async () => {
    const { default: config } = await import('../pwa-assets.config')
    const preset = (config as { preset: { maskable: { resizeOptions: { background: string } }; apple: { resizeOptions: { background: string } } } }).preset
    expect(preset.maskable.resizeOptions.background).toBe('#17181C')
    expect(preset.apple.resizeOptions.background).toBe('#17181C')
  })
})
