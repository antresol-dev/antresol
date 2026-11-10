import { randomBytes } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Dev-server-only helpers so the phone run needs no typing or copy-paste:
// - GET  /__spike/prefill?k=<token> → the test DB URL from the git-ignored repo-root .env.local (test DB only).
//   The token is random per server start and printed with the page URLs, so other devices on the
//   network that can reach a --host server cannot read the URL.
// - POST /__spike/results → appends the run's timings to results.jsonl (git-ignored)
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const resultsFile = fileURLToPath(new URL('./results.jsonl', import.meta.url))
const token = randomBytes(3).toString('hex')

function spikeEndpoints(testUrl: string | undefined): Plugin {
  return {
    name: 'neon-spike-endpoints',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]
        for (const url of urls) server.config.logger.info(`  spike page with prefill: ${url}?k=${token}`)
      })
      server.middlewares.use('/__spike/prefill', (req, res) => {
        const given = new URL(req.url ?? '', 'http://x').searchParams.get('k')
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ url: given === token ? (testUrl ?? null) : null }))
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
