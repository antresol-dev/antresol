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
  Fredoka: [600],
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

  it('self-hosts latin, latin-ext and cyrillic (the wordmark: latin and latin-ext) with font-display swap', async () => {
    const fonts = (await loadConfig()).fonts!
    expect(fonts.defaults?.subsets).toEqual(['latin', 'latin-ext', 'cyrillic'])
    for (const f of fonts.families ?? []) {
      expect(f.provider, f.name).toBe('google')
      expect(f.subsets ?? fonts.defaults?.subsets, f.name).toEqual(f.name === 'Fredoka' ? ['latin', 'latin-ext'] : ['latin', 'latin-ext', 'cyrillic'])
      expect(f.display, f.name).toBe('swap')
      expect(f.global, f.name).toBe(true) // declared for every style, fetched by the browser only when used
    }
  })

  it('preloads only Onest (the default style\'s font) and Fredoka (the wordmark)', async () => {
    const families = (await loadConfig()).fonts?.families ?? []
    const preloaded = families.filter(f => f.preload !== false).map(f => f.name)
    expect(preloaded).toEqual(['Onest', 'Fredoka'])
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

  it('globs woff2 files into the precache (the hook then keeps Onest\'s and Fredoka\'s)', async () => {
    expect((await loadConfig()).pwa!.workbox!.globPatterns?.some(g => g.includes('woff2'))).toBe(true)
  })

  it('the deploy workflow checks the generated service worker before uploading it', () => {
    const yml = readFileSync(fileURLToPath(new URL('../../../.github/workflows/deploy.yml', import.meta.url)), 'utf8')
    expect(yml.indexOf('scripts/check-sw.mjs')).toBeGreaterThan(yml.indexOf('generate'))
    expect(yml.indexOf('scripts/check-sw.mjs')).toBeLessThan(yml.indexOf('upload-pages-artifact'))
  })

  it('does not set workbox.manifestTransforms: that would replace @vite-pwa/nuxt\'s own transform (index.html to the base URL) and the worker would not install', async () => {
    expect((await loadConfig()).pwa?.workbox?.manifestTransforms).toBeUndefined()
  })

  /** What the module has set when the hook runs: its transform (index.html -> the base URL), standing in here. */
  const moduleTransform = async (entries: { url: string }[]) => ({ manifest: entries.map(e => (e.url === 'index.html' ? { ...e, url: '/' } : e)) })

  async function runHook(out: string, css: string) {
    mkdirSync(join(out, '_nuxt/fonts'), { recursive: true })
    writeFileSync(join(out, '_nuxt/entry.css'), css)
    const hook = (await loadConfig()).hooks?.['pwa:beforeBuildServiceWorker']
    if (!hook) throw new Error('no pwa:beforeBuildServiceWorker hook')
    const options = { outDir: out, workbox: { manifestTransforms: [moduleTransform] } }
    await hook(options as never)
    return options.workbox.manifestTransforms
  }

  it('precaches the woff2 files of Onest and Fredoka only, after the module\'s transform, which stays and still maps index.html to the base URL', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-fonts-'))
    const transforms = await runHook(out,
      '@font-face{font-family:Onest;src:local(Onest),url(fonts/onest-a.woff2)format("woff2");font-weight:400}'
      + '@font-face{font-family:Manrope;src:url(fonts/manrope-a.woff2)format("woff2");font-weight:400}'
      + '@font-face{font-family:"Exo 2";src:url(fonts/exo-a.woff2)format("woff2")}'
      + '@font-face{font-family:Onest;src:url(fonts/onest-b.woff2)format("woff2");font-weight:600}'
      + '@font-face{font-family:Fredoka;src:url(fonts/fredoka-a.woff2)format("woff2");font-weight:600}'
      + '@font-face{font-family:"Fredoka Fallback: Arial";src:local(Arial);font-weight:600}')
    expect(transforms).toHaveLength(2)
    expect(transforms[0]).toBe(moduleTransform)
    const entry = (url: string) => ({ url, size: 1, revision: null })
    const urls = ['_nuxt/entry.css', '_nuxt/fonts/onest-a.woff2', '_nuxt/fonts/manrope-a.woff2', '_nuxt/fonts/exo-a.woff2', '_nuxt/fonts/onest-b.woff2', '_nuxt/fonts/fredoka-a.woff2', 'index.html']
    let manifest = urls.map(entry)
    for (const t of transforms) manifest = (await (t as (e: typeof manifest) => Promise<{ manifest: typeof manifest }>)(manifest)).manifest
    expect(manifest.map(e => e.url)).toEqual(['_nuxt/entry.css', '_nuxt/fonts/onest-a.woff2', '_nuxt/fonts/onest-b.woff2', '_nuxt/fonts/fredoka-a.woff2', '/'])
  })

  it('fails the build instead of silently precaching no font when Onest is missing from the CSS', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-fonts-'))
    const transforms = await runHook(out, '@font-face{font-family:Manrope;src:url(fonts/m.woff2)}')
    const entry = (url: string) => ({ url, size: 1, revision: null })
    await expect((transforms[1] as (e: ReturnType<typeof entry>[]) => Promise<unknown>)([entry('_nuxt/entry.css'), entry('_nuxt/fonts/m.woff2')])).rejects.toThrow(/Onest/)
  })

  it('fails the build when the wordmark\'s Fredoka is missing from the CSS', async () => {
    const out = mkdtempSync(join(tmpdir(), 'gm-fonts-'))
    const transforms = await runHook(out, '@font-face{font-family:Onest;src:url(fonts/o.woff2)}')
    const entry = (url: string) => ({ url, size: 1, revision: null })
    await expect((transforms[1] as (e: ReturnType<typeof entry>[]) => Promise<unknown>)([entry('_nuxt/entry.css'), entry('_nuxt/fonts/o.woff2')])).rejects.toThrow(/Fredoka/)
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
