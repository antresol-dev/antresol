import type { Rendition } from '@antresol/core'
import { cloudinaryThumbUrl, isCloudinaryUrl } from '@antresol/files-cloudinary'
import { imgurThumbUrl, isImgurUrl } from '@antresol/files-imgur'
import { isUploadcareUrl } from '@antresol/files-uploadcare'

export { isCloudinaryUrl, isImgurUrl, isUploadcareUrl }
export type PhotoSize = 'thumb' | 'card' | 'full'
/** What display needs of a photo: its url and the stored renditions, if any (a `Photo` fits). */
export type PhotoRef = { url: string; urls?: Rendition[] | null }

const SIDE: Record<PhotoSize, number> = { thumb: 160, card: 800, full: 2048 }

export function isDeviceUrl(url: string): boolean {
  return url.startsWith('device:')
}

const CLOUDINARY_SIDE: Record<PhotoSize, number> = { thumb: 400, card: 800, full: 2048 }
/** Imgur has no size above 'h' (1024 px); the full view takes the original, which is the stored url. */
const IMGUR_SUFFIX = { thumb: 'm', card: 'l' } as const

/** Hosts whose pictures may be put in an <img>: the three photo stores (ImgBB joins with its source). */
export function isPhotoHostUrl(url: string): boolean {
  return isUploadcareUrl(url) || isCloudinaryUrl(url) || isImgurUrl(url)
}

/** Storage keeps any JSON array in `urls` unchecked, so an element may be anything; only a well-formed one is used. */
function isUsableRendition(r: unknown): r is Rendition {
  if (typeof r !== 'object' || r === null) return false
  const c = r as Record<string, unknown>
  return (
    typeof c.url === 'string' &&
    Number.isInteger(c.width) &&
    Number.isInteger(c.height) &&
    (c.fit === 'inside' || c.fit === 'cover')
  )
}

/** The stored copy to show at a size (spec 6): the smallest by area whose side reaches the size, else the largest there is.
 *  Only `inside` copies serve card and full (a `cover` copy is cropped); thumb takes any. A copy on a foreign host or a
 *  malformed one is never chosen. null: no usable copy, the caller falls back to the url. */
export function pickRendition(urls: readonly unknown[] | null | undefined, size: PhotoSize): Rendition | null {
  const allowed = (urls ?? []).filter(
    (r): r is Rendition => isUsableRendition(r) && isPhotoHostUrl(r.url) && (size === 'thumb' || r.fit === 'inside'),
  )
  const side = (r: Rendition) => (size === 'thumb' ? Math.min(r.width, r.height) : Math.max(r.width, r.height))
  const area = (r: Rendition) => r.width * r.height
  const big = allowed.filter((r) => side(r) >= SIDE[size])
  if (big.length > 0) return big.reduce((a, b) => (area(b) < area(a) ? b : a))
  if (allowed.length > 0) return allowed.reduce((a, b) => (area(b) > area(a) ? b : a))
  return null
}

/** What may be put in an <img>: a stored rendition, else the url of one of the three photo stores (transformed), and
 *  device: urls unchanged (resolved by the caller). Any other url in the data is never loaded (it would be a tracking
 *  pixel); null then. */
export function displayablePhotoUrl(photo: PhotoRef, size: PhotoSize): string | null {
  if (isDeviceUrl(photo.url)) return photo.url
  const picked = pickRendition(photo.urls, size)
  if (picked) return picked.url
  return isPhotoHostUrl(photo.url) ? photoUrl(photo.url, size) : null
}

/** By the host of the stored url, so photos stay with their own store. Uploadcare: preview transformation appended to the
 *  base (which ends with '/'); Cloudinary: transformation after /upload/; Imgur: size letter before the extension.
 *  Other URLs unchanged. */
export function photoUrl(url: string, size: PhotoSize): string {
  if (isCloudinaryUrl(url)) return cloudinaryThumbUrl(url, CLOUDINARY_SIDE[size])
  if (isImgurUrl(url)) return size === 'full' ? url : imgurThumbUrl(url, IMGUR_SUFFIX[size])
  if (!isUploadcareUrl(url)) return url
  const n = SIDE[size]
  const base = url.endsWith('/') ? url : `${url}/`
  return `${base}-/preview/${n}x${n}/-/format/auto/-/quality/smart/`
}
