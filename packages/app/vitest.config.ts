import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@graymatter/app',
    environment: 'node',
    // Vitest returns an empty string for CSS imports unless the file is included.
    css: { include: [/main\.css/] },
    include: ['test/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
