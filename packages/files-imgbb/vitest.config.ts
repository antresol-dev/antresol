import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// ANTRESOL_* variables (e.g. ANTRESOL_IMGBB_TEST_KEY) come from the git-ignored .env / .env.local in the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => ({
  test: {
    name: '@antresol/files-imgbb',
    env: loadEnv(mode, repoRoot, 'ANTRESOL_'),
    // The live test talks to the real ImgBB.
    testTimeout: 60000,
  },
}))
