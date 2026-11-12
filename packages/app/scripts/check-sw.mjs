// Checks the generated service worker (run after `nuxt generate`, before the output is uploaded):
//   node scripts/check-sw.mjs [outDir]        (default .output/public)
//  1. it evaluates: createHandlerBoundToURL(<navigateFallback>) throws `non-precached-url` at the top of sw.js when the
//     app shell is not precached under that URL (a manifestTransforms set in the config replaces @vite-pwa/nuxt's own);
//  2. the precache holds that URL (the base URL: "/" or "/graymatter/");
//  3. the only woff2 files precached are the default style's (Onest), as the built CSS names them.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import vm from 'node:vm'

const outDir = resolve(process.argv[2] ?? '.output/public')
const sw = readFileSync(join(outDir, 'sw.js'), 'utf8')
const problems = []

const precached = [...sw.matchAll(/\{url:"([^"]+)"/g)].map(m => m[1])
const handler = /createHandlerBoundToURL\)?\(\s*"([^"]+)"/.exec(sw)?.[1]
if (!handler) problems.push('sw.js has no createHandlerBoundToURL("<base>") call: the navigation fallback is gone')
else if (!precached.includes(handler)) problems.push(`createHandlerBoundToURL("${handler}"), but the precache has no {url:"${handler}"}`)

// Evaluate it the way a browser would start it, with the bare minimum of the service worker scope.
const listeners = {}
const scope = {
  location: { href: 'https://example.test' + (handler ?? '/') + 'sw.js', origin: 'https://example.test' },
  addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
  skipWaiting: () => Promise.resolve(),
  clients: { claim: () => Promise.resolve() },
  registration: { scope: 'https://example.test' + (handler ?? '/') },
  caches: {},
  fetch: () => Promise.reject(new Error('offline')),
  // sw.js loads its workbox runtime (workbox-<hash>.js, next to it) with importScripts.
  importScripts: (url) => vm.runInContext(readFileSync(join(outDir, String(url).split('/').pop()), 'utf8'), context, { filename: String(url) }),
  console,
  URL, Request, Response, Headers, Promise, setTimeout, clearTimeout, Map, Set, Object, Array,
}
scope.self = scope
const context = vm.createContext(scope)
try {
  vm.runInContext(sw, context, { filename: 'sw.js' })
  // The runtime's modules run in promise callbacks: let them finish (a failing one rejects, so catch it).
  await new Promise((resolve, reject) => {
    process.once('unhandledRejection', reject)
    setTimeout(resolve, 50)
  })
  for (const type of ['install', 'activate', 'fetch']) if (!listeners[type]) problems.push(`sw.js registers no "${type}" listener`)
} catch (e) {
  problems.push(`sw.js does not evaluate: ${e?.message ?? e}${e?.details ? ' ' + JSON.stringify(e.details) : ''}`)
}

// The precached fonts: only Onest's.
const onest = new Set()
for (const css of precached.filter(u => u.endsWith('.css'))) {
  for (const [, family, body] of readFileSync(join(outDir, css), 'utf8').matchAll(/@font-face\{font-family:"?([^;"]+)"?;([^}]*)\}/g)) {
    if (family !== 'Onest') continue
    for (const [, file] of body.matchAll(/url\(([^)]+\.woff2)\)/g)) onest.add(file.split('/').pop())
  }
}
const fonts = precached.filter(u => u.endsWith('.woff2'))
if (!onest.size) problems.push('the built CSS has no Onest @font-face')
if (!fonts.length) problems.push('no woff2 file is precached: the default style\'s font is missing offline')
for (const f of fonts) if (!onest.has(f.split('/').pop())) problems.push(`precached font that is not Onest's: ${f}`)
for (const f of onest) if (!fonts.some(u => u.endsWith('/' + f))) problems.push(`Onest's ${f} is not precached`)

if (problems.length) {
  console.error('Service worker check failed:\n - ' + problems.join('\n - '))
  process.exit(1)
}
console.log(`Service worker OK: ${precached.length} precached, shell at "${handler}", ${fonts.length} woff2 (Onest only)`)
