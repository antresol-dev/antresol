import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: '@antresol/app',
    // PGlite cold starts are slow under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Half the cores for the app's files, in a group of their own after core and storage-postgres (Vitest wants a
    // separate group for a project with its own maxWorkers). Uncapped, next to the other projects' PGlite files, the
    // app's PGlite files ran several times slower than alone (demo-source 37 s instead of 5 s).
    maxWorkers: '50%',
    sequence: { groupOrder: 1 },
    environment: 'node',
    // Vitest returns an empty string for CSS imports unless the file is included.
    css: { include: [/main\.css/] },
    include: ['test/**/*.test.ts'],
    setupFiles: ['fake-indexeddb/auto'],
  },
})
