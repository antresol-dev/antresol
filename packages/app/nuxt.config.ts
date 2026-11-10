import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-10',
  ssr: false,
  modules: ['@nuxtjs/color-mode', '@nuxt/fonts', '@nuxtjs/i18n', 'shadcn-nuxt', '@nuxt/eslint', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  },
  colorMode: {
    classSuffix: '',
    preference: 'system',
    fallback: 'light',
    storageKey: 'gm-color-mode',
  },
  fonts: {
    families: [{ name: 'Manrope', provider: 'google', weights: [400, 500, 600, 700] }],
  },
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [{ code: 'en', file: 'en.json' }],
  },
  shadcn: { prefix: '', componentDir: './app/components/ui' },
  pwa: {
    pwaAssets: { config: true },
    registerType: 'autoUpdate',
    manifest: {
      name: 'GrayMatter',
      short_name: 'GrayMatter',
      description: 'Personal inventory of anything',
      display: 'standalone',
      background_color: '#F7F7F8',
      theme_color: '#F7F7F8',
      start_url: '.',
      scope: '.',
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
      navigateFallback: '/',
    },
    devOptions: { enabled: false },
  },
  app: { head: { title: 'GrayMatter' } },
})
