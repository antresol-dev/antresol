import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@antresol/mcp',
    // PGlite cold starts are slow under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
