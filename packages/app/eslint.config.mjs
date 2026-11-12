import withNuxt from './.nuxt/eslint.config.mjs'
import vueI18n from '@intlify/eslint-plugin-vue-i18n'

export default withNuxt(
  ...vueI18n.configs.recommended,
  {
    settings: {
      'vue-i18n': { localeDir: './i18n/locales/*.json', messageSyntaxVersion: '^11.0.0' },
    },
    rules: {
      '@intlify/vue-i18n/no-raw-text': ['error', { ignorePattern: '^[\\s·…/—–:+-]+$' }],
      '@intlify/vue-i18n/no-missing-keys': 'error',
      'vue/no-v-html': 'error',
    },
  },
  {
    // Copied shadcn-vue components: keep them as generated.
    files: ['app/components/ui/**/*.vue'],
    rules: { 'vue/require-default-prop': 'off' },
  },
)
