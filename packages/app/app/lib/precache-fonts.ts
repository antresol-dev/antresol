/**
 * The service worker precaches only the fonts every screen needs: the default style's (Onest) and the Antresol wordmark's
 * (Fredoka 600, the only weight declared); the other families' woff2 files are cached on first
 * use (the gm-fonts rule in nuxt.config.ts). @nuxt/fonts hashes the file names, so these are the files its
 * @font-face rules in the built CSS point at.
 *
 * This is a manifest transform applied from the `pwa:beforeBuildServiceWorker` hook, AFTER @vite-pwa/nuxt's own
 * (index.html -> the base URL, x/index.html -> x, a revision for builds/latest.json). Setting
 * `pwa.workbox.manifestTransforms` in the config replaces the module's transform and the worker then fails to install
 * (`createHandlerBoundToURL` finds no precached base URL), so never set it there (test/fonts.test.ts).
 */

/** workbox-build's ManifestEntry and ManifestTransform (not a direct dependency, so the shape is written out). */
interface ManifestEntry {
  url: string
  revision: string | null
  integrity?: string
  size?: number
}
type SizedEntry = ManifestEntry & { size: number }
type ManifestTransform = (entries: Array<ManifestEntry & { size: number }>) => Promise<{ manifest: SizedEntry[]; warnings?: string[] }>

/** Families whose woff2 files are precached. */
export const PRECACHED_FAMILIES: ReadonlySet<string> = new Set(['Onest', 'Fredoka'])

export function precachedFonts(outDir: string): ManifestTransform {
  return async (entries) => {
    const isFont = (url: string) => url.endsWith('.woff2')
    if (!entries.some(e => isFont(e.url))) return { manifest: entries }
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const wanted = new Set<string>()
    const families = new Set<string>()
    for (const e of entries.filter(e => e.url.endsWith('.css'))) {
      for (const [, family, body] of readFileSync(join(outDir, e.url), 'utf8').matchAll(/@font-face\{font-family:"?([^;"]+)"?;([^}]*)\}/g)) {
        families.add(family!)
        if (!PRECACHED_FAMILIES.has(family!)) continue
        for (const [, file] of body!.matchAll(/url\(([^)]+\.woff2)\)/g)) wanted.add(file!.split('/').pop()!)
      }
    }
    for (const family of PRECACHED_FAMILIES) {
      if (!families.has(family)) throw new Error(`No ${family} @font-face found in the built CSS: its font would not be precached`)
    }
    return { manifest: entries.filter(e => !isFont(e.url) || wanted.has(e.url.split('/').pop()!)) }
  }
}
