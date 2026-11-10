import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@graymatter/app',
    // PGlite cold starts are slow under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
    environment: 'node',
    // Vitest returns an empty string for CSS imports unless the file is included.
    css: { include: [/main\.css/] },
    include: ['test/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
