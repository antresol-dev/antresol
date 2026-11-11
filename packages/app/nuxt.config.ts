import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { cspFor } from './app/lib/csp'

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
    storageKey: 'gm-color-mode',
  },
  fonts: {
    families: [{ name: 'Manrope', provider: 'google', weights: [400, 500, 600, 700, 800] }],
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
      name: 'GrayMatter',
      short_name: 'GrayMatter',
      description: 'Personal inventory of anything',
      display: 'standalone',
      background_color: '#EDEFF3',
      theme_color: '#EDEFF3',
      start_url: '.',
      scope: '.',
      // Relative to the manifest, so they work under /graymatter/ too. The layout reads and clears `action`.
      shortcuts: [
        { name: 'Add item', url: './?action=add' },
        { name: 'Search', url: './?action=search' },
      ],
      // "Share" from a shop app opens /share (relative, so /graymatter/share on Pages); Android puts the link in `text`.
      // GET needs no service worker of its own; a cold start goes through 404.html and navigateFallback like any deep link.
      share_target: { action: './share', method: 'GET', params: { title: 'title', text: 'text', url: 'url' } },
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      // The app shell is precached under the base URL itself ("/graymatter/"), not under "index.html".
      navigateFallback: baseURL,
      // Files with an extension (assets, manifest, sw) are never navigations to the app shell.
      navigateFallbackDenylist: [/\/[^/?]+\.[^/]+$/],
    },
    devOptions: { enabled: false },
  },
  app: {
    // GitHub Pages project sites live under /<repo>/; set NUXT_APP_BASE_URL=/graymatter/ for that build.
    baseURL,
    head: {
      title: 'GrayMatter',
      // resizes-content: on Android the keyboard shrinks the layout viewport, so bottom sheets sit above it
      // instead of behind it (Chrome's default, resizes-visual, keeps fixed elements under the keyboard).
      viewport: 'width=device-width, initial-scale=1, interactive-widget=resizes-content',
    },
  },
})
