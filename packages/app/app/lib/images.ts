import { FileError } from '@graymatter/core'

export const MAX_SIDE = 2048
export const MAX_INPUT_BYTES = 40 * 1024 * 1024
const QUALITY = 0.85

const WEB_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])
const HEIC_TYPES = new Set(['image/heic', 'image/heif'])

/** Scales down to fit max on the longer side, never up; integers >= 1. */
export function fitWithin(width: number, height: number, max: number = MAX_SIDE): { width: number; height: number } {
  const longer = Math.max(width, height)
  const k = longer > max ? max / longer : 1
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  }
}

/** True for the web image types; HEIC/HEIF are left to prepareImage, which tries to decode them. */
export function isImageType(type: string): boolean {
  return WEB_TYPES.has(type.toLowerCase())
}

/** Files this big are likely too many megapixels to decode in full on a phone: decoded straight to the reduced size. */
const DECODE_REDUCED_FROM_BYTES = 8 * 1024 * 1024

/** The browser ran out of memory (or refused the size) while decoding, as opposed to not understanding the file. */
export function isOutOfMemory(e: unknown): boolean {
  if (e instanceof RangeError) return true
  const name = (e as { name?: unknown } | null)?.name
  const message = String((e as { message?: unknown } | null)?.message ?? '')
  return name === 'QuotaExceededError' || /memory|allocation|too large|too big/i.test(message)
}

/** Decodes (EXIF-aware). Big files go straight to the reduced size (`resizeWidth`); a full decode that runs out of memory is retried reduced. */
async function decode(file: File): Promise<ImageBitmap> {
  const full: ImageBitmapOptions = { imageOrientation: 'from-image' }
  const reduced: ImageBitmapOptions = { ...full, resizeWidth: MAX_SIDE, resizeQuality: 'medium' }
  try {
    return await createImageBitmap(file, file.size > DECODE_REDUCED_FROM_BYTES ? reduced : full)
  } catch (e) {
    if (!isOutOfMemory(e)) throw new FileError('unsupported')
    if (file.size > DECODE_REDUCED_FROM_BYTES) throw new FileError('too_large_to_decode')
    try {
      return await createImageBitmap(file, reduced)
    } catch (again) {
      throw new FileError(isOutOfMemory(again) ? 'too_large_to_decode' : 'unsupported')
    }
  }
}

let webpSupport: Promise<boolean> | null = null

/** WebP encoding is checked by doing it: a browser without it answers `canvas.toBlob('image/webp')` with a PNG. */
export function supportsWebp(): Promise<boolean> {
  webpSupport ??= new Promise<boolean>((resolve) => {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      canvas.toBlob((blob) => resolve(blob?.type === 'image/webp'), 'image/webp', QUALITY)
    } catch {
      resolve(false)
    }
  })
  return webpSupport
}

/** WebP where the browser can encode it, JPEG otherwise. */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob | null> {
  const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
  if (await supportsWebp()) {
    const blob = await toBlob('image/webp')
    if (blob?.type === 'image/webp') return blob
  }
  return toBlob('image/jpeg')
}

/** Decodes (EXIF-aware), scales to MAX_SIDE and encodes WebP (JPEG where WebP is not supported) at 0.85. */
export async function prepareImage(file: File): Promise<Blob> {
  const type = file.type.toLowerCase()
  if (!isImageType(type) && !HEIC_TYPES.has(type)) throw new FileError('unsupported')
  if (file.size > MAX_INPUT_BYTES) throw new FileError('too_large')
  if (typeof createImageBitmap !== 'function') throw new FileError('unsupported')

  const bitmap = await decode(file)
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new FileError('failed')
    // Flatten onto white: JPEG has no alpha, so transparent PNGs would turn black; the same look in either format.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await encodeCanvas(canvas)
    if (!blob) throw new FileError('failed')
    return blob
  } finally {
    bitmap.close()
  }
}
