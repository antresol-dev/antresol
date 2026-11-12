import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

// ANTRESOL_* variables (e.g. ANTRESOL_IMGBB_TEST_KEY) come from the git-ignored .env / .env.local in the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
// Talks to the real ImgBB: only `pnpm --filter @antresol/files-imgbb test:live` (mode `live`) runs it, never `pnpm test`,
// even with the key set.
const LIVE = 'test/**/*.live.test.ts'

export default defineConfig(({ mode }) => {
  const live = mode === 'live'
  return {
    test: {
      name: '@antresol/files-imgbb',
      env: loadEnv(mode, repoRoot, 'ANTRESOL_'),
      include: live ? [LIVE] : ['test/**/*.test.ts'],
      exclude: live ? configDefaults.exclude : [...configDefaults.exclude, LIVE],
      // The live test talks to the real ImgBB.
      testTimeout: 60000,
    },
  }
})
