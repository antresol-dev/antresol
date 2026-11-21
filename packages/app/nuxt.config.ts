import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { cspFor } from './app/lib/csp'
import { precachedFonts } from './app/lib/precache-fonts'

const baseURL = process.env.NUXT_APP_BASE_URL ?? '/'

/**
 * Adds the CSP <meta> to a generated page, allowing exactly the executable inline scripts it contains (color-mode's
 * theme-flash script, Nuxt's bootstrap). The hashes are computed from the final HTML, so they cannot go stale.
 * `<script type="application/json">` blocks are data, not executed, and need none.
 */
function withCsp(html: string): string {
  const hashes = new Set<string>()
  for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    const attrs = m[1] ?? ''
    if (/\ssrc=/.test(attrs) || /\stype="application\/json"/.test(attrs)) continue
    hashes.add(`'sha256-${createHash('sha256').update(m[2] ?? '').digest('base64')}'`)
  }
  const meta = `<meta http-equiv="Content-Security-Policy" content="${cspFor([...hashes])}">`
  return html.replace(/<head(\s[^>]*)?>/, (head) => `${head}${meta}`)
}

export default defineNuxtConfig({
  compatibilityDate: '2026-11-10',
  ssr: false,
  modules: ['@nuxtjs/color-mode', '@nuxt/fonts', '@nuxtjs/i18n', 'shadcn-nuxt', '@nuxt/eslint', '@vite-pwa/nuxt'],
  // vue-sonner ships its toast styles separately; without them toasts render unpositioned.
  css: ['vue-sonner/style.css', '~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  },
  nitro: {
    hooks: {
      // Production only: nitro prerenders on generate, never under `nuxt dev` (which needs eval and a websocket for HMR).
      'prerender:generate': (route: { fileName?: string; contents?: string }) => {
        if (route.fileName?.endsWith('.html') && typeof route.contents === 'string') route.contents = withCsp(route.contents)
      },
      // GitHub Pages must not run Jekyll over the output (it drops _nuxt/). 404.html (the SPA fallback for deep links)
      // is written by Nuxt itself from index.html on generate.
      compiled: (nitro: { options: { output: { publicDir: string } } }) => {
        writeFileSync(join(nitro.options.output.publicDir, '.nojekyll'), '')
      },
    },
  },
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'antresol-color-mode',
  },
  fonts: {
    defaults: { subsets: ['latin', 'latin-ext', 'cyrillic'] },
    families: [
      // Onest is the Base style's font (the default style): preloaded and precached.
      { name: 'Onest', provider: 'google', weights: [400, 500, 600, 700], global: true, display: 'swap', preload: { subsets: ['latin', 'cyrillic'], weights: [400, 600] } },
      // The "Antresol" wordmark (every screen, every style): Fredoka 600 only, latin and latin-ext, preloaded and precached.
      { name: 'Fredoka', provider: 'google', weights: [600], subsets: ['latin', 'latin-ext'], global: true, display: 'swap', preload: { subsets: ['latin'], weights: [600] } },
      // The rest are declared (global: every @font-face is in the CSS, the browser fetches a face only when a style uses it),
      // never preloaded; the service worker caches them on first use (antresol-fonts).
      { name: 'Manrope', provider: 'google', weights: [400, 500, 600, 700, 800], global: true, display: 'swap', preload: false },
      { name: 'Inter', provider: 'google', weights: [400, 500, 600, 700], global: true, display: 'swap', preload: false },
      { name: 'Rubik', provider: 'google', weights: [400, 500, 600, 700], global: true, display: 'swap', preload: false },
      { name: 'Unbounded', provider: 'google', weights: [600, 700, 800], global: true, display: 'swap', preload: false },
      { name: 'Exo 2', provider: 'google', weights: [400, 500, 600, 700], global: true, display: 'swap', preload: false },
      { name: 'Jost', provider: 'google', weights: [400, 500, 600], global: true, display: 'swap', preload: false },
      { name: 'IBM Plex Sans', provider: 'google', weights: [400, 500, 600], global: true, display: 'swap', preload: false },
      { name: 'IBM Plex Mono', provider: 'google', weights: [400, 500, 600], global: true, display: 'swap', preload: false },
    ],
  },
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [{ code: 'en', file: 'en.json' }],
  },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  pwa: {
    pwaAssets: { config: true },
    registerType: 'prompt',
    manifest: {
      name: 'Antresol',
      short_name: 'Antresol',
      description: 'Personal inventory of anything',
      display: 'standalone',
      // Android paints an installed app's bottom system bar (and its launch splash) from these, one colour for every
      // theme: a neutral dark grey (Base's dark surface) instead of a white strip. The top bar follows the style through
      // the theme-color metas (lib/shell.ts).
      background_color: '#1E2026',
      theme_color: '#1E2026',
      start_url: '.',
      scope: '.',
      // Relative to the manifest, so they work under /antresol/ too. The layout reads and clears `action`.
      shortcuts: [
        { name: 'Add item', url: './?action=add' },
        { name: 'Search', url: './?action=search' },
      ],
      // "Share" from a shop app opens /share (relative, so /antresol/share on Pages); Android puts the link in `text`.
      // GET needs no service worker of its own; a cold start goes through 404.html and navigateFallback like any deep link.
      share_target: { action: './share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // Only the fonts of every screen (Onest, the default style's, and Fredoka 600, the wordmark) are precached, the rest on first use (antresol-fonts below): filtered in the
      // `pwa:beforeBuildServiceWorker` hook (hooks, below). Do NOT set manifestTransforms here: it replaces the module's own
      // transform (index.html -> the base URL) and the service worker no longer installs (app/lib/precache-fonts.ts).
      // The app shell is precached under the base URL itself ("/antresol/"), not under "index.html".
      navigateFallback: baseURL,
      // Files with an extension (assets, manifest, sw) are never navigations to the app shell.
      navigateFallbackDenylist: [/\/[^/?]+\.[^/]+$/],
      // Photos of the four stores (all send Access-Control-Allow-Origin: *, and <img crossorigin> asks with CORS): cache first,
      // only real 200 responses (statuses 0 would be opaque ones, which also balloon the storage quota). Thumbnails and
      // bigger sizes live in separate caches, each trimmed to its newest entries. Cache names: PHOTO_CACHE in lib/photo-cache.ts.
      runtimeCaching: [
        {
          // photoUrl 'thumb': Uploadcare preview 160x160, Cloudinary w_400, Imgur size letter m, ImgBB the copy marked ?antresol=thumb (app/lib/photo-url.ts; ImgBB urls carry no size).
          urlPattern: /^https:\/\/(?:(?:ucarecdn\.com|[a-z0-9.-]+\.ucarecd\.net)\/.+\/-\/preview\/160x160\/|res\.cloudinary\.com\/[^/]+\/image\/upload\/w_400,|i\.imgur\.com\/[A-Za-z0-9]+m\.[a-z0-9]+(?:$|\?)|i\.ibb\.co\/[A-Za-z0-9]+\/[^/?#]+\?antresol=thumb$)/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'antresol-photos-thumb',
            expiration: { maxEntries: 600, purgeOnQuotaError: true },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          urlPattern: /^https:\/\/(?:ucarecdn\.com|[a-z0-9.-]+\.ucarecd\.net|res\.cloudinary\.com|i\.imgur\.com|i\.ibb\.co)\//,
          handler: 'CacheFirst',
          options: {
            cacheName: 'antresol-photos-full',
            expiration: { maxEntries: 150, purgeOnQuotaError: true },
            cacheableResponse: { statuses: [200] },
          },
        },
        {
          // Fonts of the other styles (@nuxt/fonts emits them under _nuxt/fonts/): cache first, real 200 responses only, so a
          // style's font works offline once it has been used. Onest and Fredoka are already in the precache and answered from there.
          urlPattern: /\/_nuxt\/fonts\/[^/]+\.woff2(?:\?.*)?$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'antresol-fonts',
            expiration: { maxEntries: 60 },
            cacheableResponse: { statuses: [200] },
          },
        },
      ],
    },
    devOptions: { enabled: false },
  },
  hooks: {
    // After @vite-pwa/nuxt has set its default manifest transform: ours is added to it, not put in its place.
    'pwa:beforeBuildServiceWorker': (options) => {
      options.workbox.manifestTransforms = [...(options.workbox.manifestTransforms ?? []), precachedFonts(options.outDir)]
    },
  },
  app: {
    // GitHub Pages project sites live under /<repo>/; set NUXT_APP_BASE_URL=/antresol/ for that build.
    baseURL,
    head: {
      title: 'Antresol',
      // resizes-content: on Android the keyboard shrinks the layout viewport, so bottom sheets sit above it
      // instead of behind it (Chrome's default, resizes-visual, keeps fixed elements under the keyboard).
      viewport: 'width=device-width, initial-scale=1, interactive-widget=resizes-content, viewport-fit=cover',
    },
  },
})
