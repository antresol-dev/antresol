import { parseRendition, type Rendition } from '@antresol/core'
import { cloudinaryThumbUrl, isCloudinaryUrl } from '@antresol/files-cloudinary'
import { isImgbbUrl } from '@antresol/files-imgbb'
import { imgurThumbUrl, isImgurUrl } from '@antresol/files-imgur'
import { isUploadcareUrl } from '@antresol/files-uploadcare'

export { isCloudinaryUrl, isImgbbUrl, isImgurUrl, isUploadcareUrl }
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

/** Hosts whose pictures may be put in an <img>: the four photo stores. */
export function isPhotoHostUrl(url: string): boolean {
  return isUploadcareUrl(url) || isCloudinaryUrl(url) || isImgbbUrl(url) || isImgurUrl(url)
}

/** The stored copy to show at a size (spec 6): the smallest by area whose side reaches the size, else the largest there is.
 *  Only `inside` copies serve card and full (a `cover` copy is cropped); thumb takes any. A copy on a foreign host, or one
 *  core's parseRendition refuses, is never chosen (reads drop those, but an inventory saved on the device may be older);
 *  `urls` that is not a list is none. null: no usable copy, the caller falls back to the url. */
export function pickRendition(urls: unknown, size: PhotoSize): Rendition | null {
  const allowed = (Array.isArray(urls) ? urls : []).filter(
    (r): r is Rendition => parseRendition(r) !== null && isPhotoHostUrl(r.url) && (size === 'thumb' || r.fit === 'inside'),
  )
  const side = (r: Rendition) => (size === 'thumb' ? Math.min(r.width, r.height) : Math.max(r.width, r.height))
  const area = (r: Rendition) => r.width * r.height
  const big = allowed.filter((r) => side(r) >= SIDE[size])
  if (big.length > 0) return big.reduce((a, b) => (area(b) < area(a) ? b : a))
  if (allowed.length > 0) return allowed.reduce((a, b) => (area(b) > area(a) ? b : a))
  return null
}

/** Query the service worker caches with the thumbnails (nuxt.config.ts matches it): ImgBB has no size in its urls and
 *  ignores the query. Only hosts where this was checked get it; today that is ImgBB. */
const THUMB_MARK = '?antresol=thumb'
/** Only a small copy is marked: one picked for thumb for want of a thumb copy (an original) stays out of the 600
 *  thumbnails. */
const THUMB_MARK_MAX_SIDE = 2 * SIDE.thumb

/** `url` without the thumbnail cache mark displayablePhotoUrl may have put on it. */
export function withoutThumbMark(url: string): string {
  return url.endsWith(THUMB_MARK) ? url.slice(0, -THUMB_MARK.length) : url
}

/** What may be put in an <img>: a stored rendition (a small ImgBB one picked for thumb carries the cache mark), else the
 *  url of one of the four photo stores (transformed), and device: urls unchanged (resolved by the caller). Any other url
 *  in the data is never loaded (it would be a tracking pixel); null then. */
export function displayablePhotoUrl(photo: PhotoRef, size: PhotoSize): string | null {
  if (isDeviceUrl(photo.url)) return photo.url
  const picked = pickRendition(photo.urls, size)
  if (picked) {
    const small = Math.min(picked.width, picked.height) <= THUMB_MARK_MAX_SIDE
    return size === 'thumb' && small && isImgbbUrl(picked.url) ? `${picked.url}${THUMB_MARK}` : picked.url
  }
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
