import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Dev-server-only helpers so the phone run needs no typing or copy-paste:
// - GET  /__spike/prefill → the test DB URL from the git-ignored repo-root .env.local (test DB only),
//   answered only to loopback clients: this machine's browser and a phone over `adb reverse`.
//   Other devices reaching a --host server get null.
// - POST /__spike/results → appends the run's timings to results.jsonl (git-ignored)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const resultsFile = fileURLToPath(new URL('./results.jsonl', import.meta.url))
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

function spikeEndpoints(testUrl: string | undefined): Plugin {
  return {
    name: 'neon-spike-endpoints',
    configureServer(server) {
      server.middlewares.use('/__spike/prefill', (req, res) => {
        const loopback = LOOPBACK.has(req.socket.remoteAddress ?? '')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ url: loopback ? (testUrl ?? null) : null }))
      })
      server.middlewares.use('/__spike/results', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
          appendFileSync(resultsFile, JSON.stringify(JSON.parse(body)) + '\n')
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'GM_')
  return { plugins: [spikeEndpoints(env.GM_NEON_TEST_URL)] }
})
