import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FALLBACK_BASES, FONT_FAMILIES, withFallbacks } from '../app/lib/styles/fonts'
import { STYLES, STYLE_NAMES } from '../app/lib/styles/registry'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)

const WEIGHTS: Record<string, number[]> = {
  Onest: [400, 500, 600, 700],
  Manrope: [400, 500, 600, 700, 800],
  Inter: [400, 500, 600, 700],
  Rubik: [400, 500, 600, 700],
  Unbounded: [600, 700, 800],
  'Exo 2': [400, 500, 600, 700],
  Jost: [400, 500, 600],
  'IBM Plex Sans': [400, 500, 600],
  'IBM Plex Mono': [400, 500, 600],
}

async function loadConfig() {
  vi.resetModules()
  return (await import('../nuxt.config')).default
}

afterEach(() => vi.restoreAllMocks())

describe('style fonts config', () => {
  it('declares every family of the styles with the weights of the mock-up', async () => {
    const families = (await loadConfig()).fonts?.families ?? []
    expect(families.map(f => f.name).sort()).toEqual(Object.keys(WEIGHTS).sort())
    for (const f of families) expect(f.weights, f.name).toEqual(WEIGHTS[f.name!])
  })

  it('self-hosts latin, latin-ext and cyrillic with font-display swap', async () => {
    const fonts = (await loadConfig()).fonts!
    expect(fonts.defaults?.subsets).toEqual(['latin', 'latin-ext', 'cyrillic'])
    for (const f of fonts.families ?? []) {
      expect(f.provider, f.name).toBe('google')
      expect(f.subsets ?? fonts.defaults?.subsets, f.name).toEqual(['latin', 'latin-ext', 'cyrillic'])
      expect(f.display, f.name).toBe('swap')
      expect(f.global, f.name).toBe(true) // declared for every style, fetched by the browser only when used
    }
  })

  it('preloads only Onest, the default (Base) style font', async () => {
    const families = (await loadConfig()).fonts?.families ?? []
    const preloaded = families.filter(f => f.preload !== false).map(f => f.name)
    expect(preloaded).toEqual(['Onest'])
  })

  it('caches the other fonts on first use: CacheFirst, gm-fonts, 60 files, status 200 only', async () => {
    const rule = (await loadConfig()).pwa?.workbox?.runtimeCaching?.find(r => r.options?.cacheName === 'gm-fonts')
    if (!rule) throw new Error('no gm-fonts rule')
    expect(rule.handler).toBe('CacheFirst')
    expect(rule.options?.expiration?.maxEntries).toBe(60)
    expect(rule.options?.cacheableResponse?.statuses).toEqual([200])
    const re = rule.urlPattern as RegExp
    expect(re.test('https://x.github.io/graymatter/_nuxt/fonts/abc-DEF_1.woff2')).toBe(true)
    expect(re.test('https://x.test/_nuxt/fonts/abc.woff2')).toBe(true)
    expect(re.test('https://x.test/_nuxt/abc.js')).toBe(false)
  })

  it('keeps the photo caches', async () => {
    const names = (await loadConfig()).pwa?.workbox?.runtimeCaching?.map(r => r.options?.cacheName)
    expect(names).toEqual(expect.arrayContaining(['gm-photos-thumb', 'gm-photos-full']))
  })

  it('precaches the woff2 files of Onest only', async () => {
    const workbox = (await loadConfig()).pwa!.workbox!
    expect(workbox.globPatterns?.some(g => g.includes('woff2'))).toBe(true)
    const out = mkdtempSync(join(tmpdir(), 'gm-fonts-'))
    mkdirSync(join(out, '.output/public/_nuxt/fonts'), { recursive: true })
    writeFileSync(join(out, '.output/public/_nuxt/entry.css'),
      '@font-face{font-family:Onest;src:local(Onest),url(fonts/onest-a.woff2)format("woff2");font-weight:400}'
      + '@font-face{font-family:Manrope;src:url(fonts/manrope-a.woff2)format("woff2");font-weight:400}'
      + '@font-face{font-family:"Exo 2";src:url(fonts/exo-a.woff2)format("woff2")}'
      + '@font-face{font-family:Onest;src:url(fonts/onest-b.woff2)format("woff2");font-weight:600}')
    vi.spyOn(process, 'cwd').mockReturnValue(out)
    const transform = workbox.manifestTransforms![0]!
    const entry = (url: string) => ({ url, size: 1, revision: null })
    const urls = ['_nuxt/entry.css', '_nuxt/fonts/onest-a.woff2', '_nuxt/fonts/manrope-a.woff2', '_nuxt/fonts/exo-a.woff2', '_nuxt/fonts/onest-b.woff2', 'index.html']
    const { manifest } = await transform(urls.map(entry))
    expect(manifest.map(e => e.url)).toEqual(['_nuxt/entry.css', '_nuxt/fonts/onest-a.woff2', '_nuxt/fonts/onest-b.woff2', 'index.html'])
  })

  it('fails the build instead of silently precaching no font when Onest is missing from the CSS', async () => {
    const workbox = (await loadConfig()).pwa!.workbox!
    const out = mkdtempSync(join(tmpdir(), 'gm-fonts-'))
    mkdirSync(join(out, '.output/public/_nuxt'), { recursive: true })
    writeFileSync(join(out, '.output/public/_nuxt/entry.css'), '@font-face{font-family:Manrope;src:url(fonts/m.woff2)}')
    vi.spyOn(process, 'cwd').mockReturnValue(out)
    const entry = (url: string) => ({ url, size: 1, revision: null })
    await expect(workbox.manifestTransforms![0]!([entry('_nuxt/entry.css'), entry('_nuxt/fonts/m.woff2')])).rejects.toThrow(/Onest/)
  })
})

/*
 * @nuxt/fonts writes a family's metric-matched "<Family> Fallback: …" faces only for the first family of a CSS
 * font-family declaration, so main.css has one rule per family and every style's stacks name the faces.
 * (Checked in a `nuxt generate` build: the built CSS holds 5 fallback faces for each of the nine families.)
 */
describe('fallback font faces', () => {
  const mainCss = readFileSync(fileURLToPath(new URL('../app/assets/css/main.css', import.meta.url)), 'utf8')
  const tokens = STYLE_NAMES.flatMap(name => (['light', 'dark'] as const).map(mode => ({ name, t: STYLES[name].build(mode, STYLES[name].defaultAccent) })))
  const stacks = (t: Record<string, unknown>) => [t.font, t.headFont, t.labelFont, t.numFont, t.chipFont].filter((v): v is string => typeof v === 'string' && v !== 'inherit')

  it('lists exactly the families nuxt.config declares', async () => {
    const families = (await loadConfig()).fonts?.families ?? []
    expect([...FONT_FAMILIES].sort()).toEqual(families.map(f => f.name).sort())
  })

  it('main.css names every family as the first family of its own font-family declaration', () => {
    for (const family of FONT_FAMILIES) {
      expect(mainCss, family).toMatch(new RegExp(`font-family:\\s*'${family}',`))
    }
  })

  it('every style names the fallback faces right after each of its families', () => {
    for (const { name, t } of tokens) {
      const used = new Set<string>()
      for (const stack of stacks(t as unknown as Record<string, unknown>)) {
        for (const family of FONT_FAMILIES) {
          if (!stack.includes(`'${family}'`)) continue
          used.add(family)
          expect(stack, `${name}: ${family}`).toContain(withFallbacks(family))
        }
      }
      for (const family of STYLES[name].fonts) expect(used.has(family), `${name} uses ${family}`).toBe(true)
    }
  })

  it('a fallback names every base the module matches', () => {
    expect(withFallbacks('Manrope')).toBe("'Manrope', " + FALLBACK_BASES.map(b => `"Manrope Fallback: ${b}"`).join(', '))
  })
})
