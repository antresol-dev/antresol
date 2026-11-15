import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(pkgDir, 'dist')
const fixtures = path.join(pkgDir, 'test', 'fixtures')

// The built server must work with nothing but dist/ next to it: no node_modules, no connection.
const clients: Client[] = []
async function start(): Promise<Client> {
  const env: Record<string, string> = { ANTRESOL_PHOTOS_DIR: fixtures, PATH: process.env.PATH ?? '' }
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(dist, 'server.mjs')], env, cwd: dist })
  const client = new Client({ name: 'Bundle Test', version: '1.0.0' })
  await client.connect(transport)
  clients.push(client)
  return client
}

describe('bundled server', () => {
  beforeAll(() => {
    execFileSync('pnpm', ['--filter', '@antresol/mcp', 'build'], { cwd: pkgDir, stdio: 'pipe' })
  }, 120_000)

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close()))
  })

  it('puts the codecs next to the server', () => {
    for (const file of ['mozjpeg_dec', 'mozjpeg_enc', 'squoosh_png_bg', 'webp_dec', 'webp_enc', 'squoosh_resize_bg'])
      expect(existsSync(path.join(dist, `${file}.wasm`)), file).toBe(true)
  })

  it('answers initialize and tools/list without a connection key, and says how to connect', async () => {
    const client = await start()
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['add_intake_lines', 'view_photos']))
    const overview = (await client.callTool({ name: 'get_overview', arguments: {} })) as { isError?: boolean; content: { text: string }[] }
    expect(overview.isError).toBe(true)
    expect(overview.content[0]!.text).toMatch(/Connect AI/)
  })

  it('decodes and shrinks PNG and HEIC photos with the codecs next to it', async () => {
    const client = await start()
    const shown = (await client.callTool({ name: 'view_photos', arguments: { paths: ['gradient.png', 'gradient.heic'] } })) as {
      isError?: boolean
      content: { type: string }[]
    }
    expect(shown.isError).toBeFalsy()
    expect(shown.content.filter((c) => c.type === 'image')).toHaveLength(2)
  })
})
