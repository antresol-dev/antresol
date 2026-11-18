// Builds dist/bundle/ (manifest, icon, server/ with the one-file server and its .wasm files), runs `mcpb validate` and
// `mcpb pack` to dist/antresol.mcpb and also zips the server alone (dist/antresol-mcp-node.zip) for MCP apps that
// run a plain command. Run `pnpm build` first (`pnpm --filter @antresol/mcp run pack:mcpb` does both).
//
// Only a tag build (GITHUB_REF_TYPE=tag, the MCP release workflow) keeps the plain package version. Every other build
// is stamped as a pre-release of the next patch, e.g. 0.1.0 → 0.1.1-dev.202611181015 (UTC): Claude Desktop silently
// ignores a .mcpb whose version is already installed, so each local build needs a version of its own to install over
// the previous one.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

const release = process.env.GITHUB_REF_TYPE === 'tag'
if (!release) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version)
  if (!m) throw new Error(`package.json version ${pkg.version} is not a plain x.y.z`)
  const stamp = new Date().toISOString().slice(0, 16).replace(/\D/g, '')
  manifest.version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}-dev.${stamp}`
}

rmSync(bundle, { recursive: true, force: true })
mkdirSync(path.join(bundle, 'server'), { recursive: true })
writeFileSync(path.join(bundle, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
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
console.log(`Packed ${path.join(dist, 'antresol.mcpb')} (version ${manifest.version}) and ${zip}`)
