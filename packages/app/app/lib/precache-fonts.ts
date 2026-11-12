/**
 * The service worker precaches only the default style's font (Onest); the other families' woff2 files are cached on first
 * use (the gm-fonts rule in nuxt.config.ts). @nuxt/fonts hashes the file names, so Onest's files are the ones its
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

export function onestOnly(outDir: string): ManifestTransform {
  return async (entries) => {
    const isFont = (url: string) => url.endsWith('.woff2')
    if (!entries.some(e => isFont(e.url))) return { manifest: entries }
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const onest = new Set<string>()
    for (const e of entries.filter(e => e.url.endsWith('.css'))) {
      for (const [, family, body] of readFileSync(join(outDir, e.url), 'utf8').matchAll(/@font-face\{font-family:"?([^;"]+)"?;([^}]*)\}/g)) {
        if (family !== 'Onest') continue
        for (const [, file] of body!.matchAll(/url\(([^)]+\.woff2)\)/g)) onest.add(file!.split('/').pop()!)
      }
    }
    if (!onest.size) throw new Error('No Onest @font-face found in the built CSS: the default style\'s font would not be precached')
    return { manifest: entries.filter(e => !isFont(e.url) || onest.has(e.url.split('/').pop()!)) }
  }
}
