// Builds dist/bundle/ (manifest, icon, server/ with the one-file server and its .wasm files), runs `mcpb validate` and
// `mcpb pack` to dist/antresol.mcpb and also zips the server alone (dist/antresol-mcp-node.zip) for MCP apps that
// run a plain command. Run `pnpm build` first (`pnpm --filter @antresol/mcp run pack:mcpb` does both).
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const bundle = path.join(dist, 'bundle')
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

run('pnpm', ['build'])

const manifest = JSON.parse(readFileSync(path.join(root, 'mcpb', 'manifest.json'), 'utf8'))
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
if (manifest.version !== pkg.version) throw new Error(`manifest.json version ${manifest.version} differs from package.json ${pkg.version}`)

rmSync(bundle, { recursive: true, force: true })
mkdirSync(path.join(bundle, 'server'), { recursive: true })
cpSync(path.join(root, 'mcpb', 'manifest.json'), path.join(bundle, 'manifest.json'))
cpSync(path.join(root, 'mcpb', 'icon.png'), path.join(bundle, 'icon.png'))
const files = readdirSync(dist).filter((f) => f === 'server.mjs' || f.endsWith('.wasm'))
if (!files.includes('server.mjs')) throw new Error('dist/server.mjs is missing')
for (const f of files) cpSync(path.join(dist, f), path.join(bundle, 'server', f))

const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb')
run(mcpb, ['validate', path.join(bundle, 'manifest.json')])
run(mcpb, ['pack', bundle, path.join(dist, 'antresol.mcpb')])

// The server and its codecs, without the manifest: unzip anywhere and point `node` at server.mjs.
const zip = path.join(dist, 'antresol-mcp-node.zip')
rmSync(zip, { force: true })
run('zip', ['-q', '-j', zip, ...files.map((f) => path.join(bundle, 'server', f))])
if (!existsSync(zip)) throw new Error('zip failed')
console.log(`Packed ${path.join(dist, 'antresol.mcpb')} and ${zip}`)
