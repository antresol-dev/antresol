import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-10',
  ssr: false,
  modules: ['@nuxtjs/color-mode', '@nuxt/fonts', '@nuxtjs/i18n', 'shadcn-nuxt', '@nuxt/eslint'],
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
  app: { head: { title: 'GrayMatter' } },
})
