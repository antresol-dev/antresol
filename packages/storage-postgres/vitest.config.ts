import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// ANTRESOL_* variables (e.g. ANTRESOL_NEON_TEST_URL) come from the git-ignored .env / .env.local in the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  test: {
    name: '@antresol/storage-postgres',
    env: loadEnv(mode, repoRoot, 'ANTRESOL_'),
    // PGlite cold starts are slow under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
}))
