import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import decodeJpeg, { init as initJpegDecoder } from '@jsquash/jpeg/decode.js'
import encodeJpeg, { init as initJpegEncoder } from '@jsquash/jpeg/encode.js'
import decodePng, { init as initPngDecoder } from '@jsquash/png/decode.js'
import resizeImage, { initResize } from '@jsquash/resize'
import decodeWebp, { init as initWebpDecoder } from '@jsquash/webp/decode.js'
import encodeWebp, { init as initWebpEncoder } from '@jsquash/webp/encode.js'
import decodeHeic from 'heic-decode'
import { ToolError } from './errors'

/** Longest side of a photo sent to the photo store (the same as the app). */
export const STORE_MAX_SIDE = 2048
/** Longest side of a photo shown to the model, and the size limit of the base64 text. */
export const MODEL_MAX_SIDE = 1568
export const MODEL_MAX_BASE64 = 1024 * 1024
const STORE_QUALITY = 85

export interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray<ArrayBuffer>
}

/** Where the codecs' .wasm files are: `<dir>/<file name>` when ANTRESOL_WASM_DIR is set (a bundled server copies them
 *  next to itself), else inside the installed package. The ONLY place that knows where they live. */
function wasmPath(pkg: string, relative: string): string {
  const dir = process.env.ANTRESOL_WASM_DIR
  if (dir) return path.join(dir, path.basename(relative))
  const root = path.dirname(createRequire(import.meta.url).resolve(`${pkg}/package.json`))
  return path.join(root, relative)
}

async function wasmModule(pkg: string, relative: string): Promise<WebAssembly.Module> {
  return WebAssembly.compile(await readFile(wasmPath(pkg, relative)))
}

// The codecs build their results with the browser's ImageData; Node has none.
if (typeof (globalThis as { ImageData?: unknown }).ImageData === 'undefined') {
  class NodeImageData {
    readonly data: Uint8ClampedArray
    readonly width: number
    readonly height: number
    constructor(data: Uint8ClampedArray | number, width: number, height?: number) {
      if (typeof data === 'number') {
        this.width = data
        this.height = width
        this.data = new Uint8ClampedArray(data * width * 4)
      } else {
        this.data = data
        this.width = width
        this.height = height ?? data.length / 4 / width
      }
    }
  }
  ;(globalThis as { ImageData?: unknown }).ImageData = NodeImageData
}

const ready = new Map<string, Promise<void>>()
function once(key: string, start: () => Promise<unknown>): Promise<void> {
  let p = ready.get(key)
  if (!p) {
    p = start().then(() => undefined)
    // A failed start is tried again by the next call.
    p.catch(() => ready.delete(key))
    ready.set(key, p)
  }
  return p
}

const readyJpegDecoder = () =>
  once('jpeg-dec', async () => initJpegDecoder(await wasmModule('@jsquash/jpeg', 'codec/dec/mozjpeg_dec.wasm')))
const readyJpegEncoder = () =>
  once('jpeg-enc', async () => initJpegEncoder(await wasmModule('@jsquash/jpeg', 'codec/enc/mozjpeg_enc.wasm')))
const readyPngDecoder = () =>
  once('png-dec', async () => initPngDecoder(await wasmModule('@jsquash/png', 'codec/pkg/squoosh_png_bg.wasm')))
const readyWebpDecoder = () =>
  once('webp-dec', async () => initWebpDecoder(await wasmModule('@jsquash/webp', 'codec/dec/webp_dec.wasm')))
const readyWebpEncoder = () =>
  once('webp-enc', async () => initWebpEncoder(await wasmModule('@jsquash/webp', 'codec/enc/webp_enc.wasm')))
const readyResize = () =>
  once('resize', async () => initResize(await wasmModule('@jsquash/resize', 'lib/resize/pkg/squoosh_resize_bg.wasm')))

type Kind = 'jpeg' | 'png' | 'webp' | 'heic'

/** The format by the file's first bytes (the extension is not trusted); null when it is none of the four. */
function sniff(b: Uint8Array): Kind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  const tag = (from: number) => String.fromCharCode(...b.subarray(from, from + 4))
  if (b.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'webp'
  if (b.length >= 12 && tag(4) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(tag(8))) return 'heic'
  return null
}

const own = (bytes: Uint8Array): ArrayBuffer => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

/** Decodes JPEG, PNG, WebP and HEIC/HEIF (EXIF orientation applied) to RGBA pixels. */
export async function decodeImage(bytes: Uint8Array, name: string): Promise<Pixels> {
  const kind = sniff(bytes)
  if (kind === null) throw new ToolError(`not an image this server can read: ${name}`)
  try {
    if (kind === 'heic') {
      const image = await decodeHeic({ buffer: bytes })
      return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.byteLength) }
    }
    if (kind === 'jpeg') await readyJpegDecoder()
    else if (kind === 'png') await readyPngDecoder()
    else await readyWebpDecoder()
    const decode = kind === 'jpeg' ? decodeJpeg : kind === 'png' ? decodePng : decodeWebp
    const image = await decode(own(bytes))
    return { width: image.width, height: image.height, data: image.data }
  } catch (e) {
    throw new ToolError(`could not decode ${name}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function fit(width: number, height: number, max: number): { width: number; height: number } {
  const longer = Math.max(width, height)
  const k = longer > max ? max / longer : 1
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) }
}

/** Scaled down to fit `max` on the longer side, never up. */
async function scaled(pixels: Pixels, max: number): Promise<Pixels> {
  const size = fit(pixels.width, pixels.height, max)
  if (size.width === pixels.width && size.height === pixels.height) return pixels
  await readyResize()
  const out = await resizeImage(new ImageData(pixels.data, pixels.width, pixels.height), { ...size, method: 'lanczos3' })
  return { width: out.width, height: out.height, data: out.data }
}

const asImageData = (p: Pixels) => new ImageData(p.data, p.width, p.height)

export async function encodeToJpeg(p: Pixels, quality: number): Promise<Uint8Array> {
  await readyJpegEncoder()
  return new Uint8Array(await encodeJpeg(asImageData(p), { quality }))
}

/** The upload name: neutral, so the original file name never leaves the computer (the app's `uploadName`). */
export function uploadName(type: string): string {
  return type === 'image/webp' ? 'photo.webp' : 'photo.jpg'
}

/** For the photo store: at most 2048 px on the longer side, WebP (JPEG when WebP fails), quality 0.85, neutral name. */
export async function forStore(bytes: Uint8Array, name: string): Promise<{ blob: Blob; name: string; width: number; height: number }> {
  const p = await scaled(await decodeImage(bytes, name), STORE_MAX_SIDE)
  try {
    await readyWebpEncoder()
    const webp = await encodeWebp(asImageData(p), { quality: STORE_QUALITY })
    return { blob: new Blob([webp], { type: 'image/webp' }), name: uploadName('image/webp'), width: p.width, height: p.height }
  } catch {
    const jpeg = await encodeToJpeg(p, STORE_QUALITY)
    return { blob: new Blob([jpeg as BlobPart], { type: 'image/jpeg' }), name: uploadName('image/jpeg'), width: p.width, height: p.height }
  }
}

/** For the model: JPEG, at most 1568 px on the longer side and 1 MB of base64 (quality, then size, goes down until it fits). */
export async function forModel(bytes: Uint8Array, name: string): Promise<{ data: string; mimeType: 'image/jpeg' }> {
  let p = await scaled(await decodeImage(bytes, name), MODEL_MAX_SIDE)
  let quality = 80
  for (;;) {
    const data = Buffer.from(await encodeToJpeg(p, quality)).toString('base64')
    if (data.length <= MODEL_MAX_BASE64) return { data, mimeType: 'image/jpeg' }
    if (quality > 40) quality -= 15
    else p = await scaled(p, Math.round(Math.max(p.width, p.height) * 0.75))
  }
}
