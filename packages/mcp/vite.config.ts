import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

/** The codecs' .wasm files, by package. images.ts finds them next to the bundle by file name. */
const WASM: Array<[pkg: string, relative: string]> = [
  ['@jsquash/jpeg', 'codec/dec/mozjpeg_dec.wasm'],
  ['@jsquash/jpeg', 'codec/enc/mozjpeg_enc.wasm'],
  ['@jsquash/png', 'codec/pkg/squoosh_png_bg.wasm'],
  ['@jsquash/webp', 'codec/dec/webp_dec.wasm'],
  ['@jsquash/webp', 'codec/enc/webp_enc.wasm'],
  ['@jsquash/resize', 'lib/resize/pkg/squoosh_resize_bg.wasm'],
]

function copyWasm(): Plugin {
  return {
    name: 'antresol-copy-wasm',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir ?? path.join(here, 'dist')
      mkdirSync(out, { recursive: true })
      for (const [pkg, relative] of WASM) {
        const root = path.dirname(require.resolve(`${pkg}/package.json`))
        copyFileSync(path.join(root, relative), path.join(out, path.basename(relative)))
      }
    },
  }
}

// One ESM file for Node 20+ with every dependency inlined (no node_modules next to it), plus the .wasm side files.
export default defineConfig({
  root: here,
  plugins: [copyWasm()],
  define: { __ANTRESOL_BUNDLED__: 'true' },
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: path.join(here, 'src/main.ts'),
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: {
        format: 'es',
        inlineDynamicImports: true,
        entryFileNames: 'server.mjs',
        // Bundled CommonJS dependencies (the HEIC decoder's emscripten glue) still use require, __dirname and __filename.
        banner: [
          "import { createRequire as __createRequire } from 'node:module';",
          "import { fileURLToPath as __fileURLToPath } from 'node:url';",
          "import { dirname as __dirnameOf } from 'node:path';",
          'const require = __createRequire(import.meta.url);',
          'const __filename = __fileURLToPath(import.meta.url);',
          'const __dirname = __dirnameOf(__filename);',
        ].join('\n'),
      },
    },
  },
})
