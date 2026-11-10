import { FileError } from '@graymatter/core'

export const MAX_SIDE = 2048
export const MAX_INPUT_BYTES = 40 * 1024 * 1024
const JPEG_QUALITY = 0.85

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

/** Decodes (EXIF-aware), scales to MAX_SIDE and encodes JPEG 0.85. */
export async function prepareImage(file: File): Promise<Blob> {
  const type = file.type.toLowerCase()
  if (!isImageType(type) && !HEIC_TYPES.has(type)) throw new FileError('unsupported')
  if (file.size > MAX_INPUT_BYTES) throw new FileError('too_large')
  if (typeof createImageBitmap !== 'function') throw new FileError('unsupported')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new FileError('unsupported')
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new FileError('failed')
    // JPEG has no alpha: flatten onto white so transparent PNGs do not turn black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) throw new FileError('failed')
    return blob
  } finally {
    bitmap.close()
  }
}
