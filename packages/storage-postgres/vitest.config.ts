import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// GM_* variables (e.g. GM_NEON_TEST_URL) come from the git-ignored .env / .env.local in the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  test: {
    name: '@graymatter/storage-postgres',
    env: loadEnv(mode, repoRoot, 'GM_'),
    // PGlite cold starts are slow under parallel load.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
}))
