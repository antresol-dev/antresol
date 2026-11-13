import { FileError } from '@antresol/core'

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

/** The browser ran out of memory (or refused the size) while decoding, as opposed to not understanding the file. Chrome
 *  says "The ImageBitmap could not be allocated." (an InvalidStateError). */
export function isOutOfMemory(e: unknown): boolean {
  if (e instanceof RangeError) return true
  const name = (e as { name?: unknown } | null)?.name
  const message = String((e as { message?: unknown } | null)?.message ?? '')
  return name === 'QuotaExceededError' || /memory|allocat|too (large|big)/i.test(message)
}

const isInvalidState = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === 'InvalidStateError'

type Size = { width: number; height: number }

/** The size the image shows at (EXIF orientation applied), read by an <img> from the file's header without decoding
 *  the pixels. null where the browser cannot tell (no DOM, or a type it cannot show). */
export function naturalSize(file: Blob): Promise<Size | null> {
  if (typeof Image !== 'function' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null)
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (size: Size | null) => {
      img.onload = img.onerror = null
      URL.revokeObjectURL(url)
      resolve(size)
    }
    img.onload = () =>
      done(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null)
    img.onerror = () => done(null)
    img.src = url
  })
}

const FULL: ImageBitmapOptions = { imageOrientation: 'from-image' }

/** Decode options that bring the longer side down to MAX_SIDE; only that side is given, so the browser keeps the aspect
 *  ratio. null when the image already fits (a reduced decode would upscale it). */
function reducedOptions(size: Size): ImageBitmapOptions | null {
  if (Math.max(size.width, size.height) <= MAX_SIDE) return null
  const fit = fitWithin(size.width, size.height)
  const side = size.width >= size.height ? { resizeWidth: fit.width } : { resizeHeight: fit.height }
  return { ...FULL, ...side, resizeQuality: 'medium' }
}

/** Decodes (EXIF-aware). The size is read first, so a reduced decode only ever scales down. Big files go straight to
 *  the reduced size; a full decode that runs out of memory, or that Chrome cannot do for a web image, is retried
 *  reduced. A size the browser cannot read means a full decode only. */
async function decode(file: File, web: boolean): Promise<ImageBitmap> {
  const size = await naturalSize(file)
  const reduced = size && reducedOptions(size)
  const straight = reduced !== null && file.size > DECODE_REDUCED_FROM_BYTES
  try {
    return await createImageBitmap(file, straight ? reduced : FULL)
  } catch (e) {
    const memory = isOutOfMemory(e)
    if (!reduced || straight || !(memory || (web && isInvalidState(e)))) {
      throw new FileError(memory ? 'too_large_to_decode' : 'unsupported')
    }
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

/** An encoded photo with the size it was drawn at. */
export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

/** The name sent to the photo store: neutral, so the original file name (often a date or a place) never leaves the device. */
export function uploadName(type: string): string {
  return type === 'image/webp' ? 'photo.webp' : 'photo.jpg'
}

/** Decodes (EXIF-aware), scales to MAX_SIDE and encodes WebP (JPEG where WebP is not supported) at 0.85. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const type = file.type.toLowerCase()
  if (!isImageType(type) && !HEIC_TYPES.has(type)) throw new FileError('unsupported')
  if (file.size > MAX_INPUT_BYTES) throw new FileError('too_large')
  if (typeof createImageBitmap !== 'function') throw new FileError('unsupported')

  const bitmap = await decode(file, isImageType(type))
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
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}
