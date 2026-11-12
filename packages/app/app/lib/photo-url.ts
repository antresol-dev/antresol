import { cloudinaryThumbUrl, isCloudinaryUrl } from '@antresol/files-cloudinary'
import { imgurThumbUrl, isImgurUrl } from '@antresol/files-imgur'
import { isUploadcareUrl } from '@antresol/files-uploadcare'

export { isCloudinaryUrl, isImgurUrl, isUploadcareUrl }
export type PhotoSize = 'thumb' | 'card' | 'full'

const SIDE: Record<PhotoSize, number> = { thumb: 160, card: 800, full: 2048 }

export function isDeviceUrl(url: string): boolean {
  return url.startsWith('device:')
}

const CLOUDINARY_SIDE: Record<PhotoSize, number> = { thumb: 400, card: 800, full: 2048 }
/** Imgur has no size above 'h' (1024 px); the full view takes the original, which is the stored url. */
const IMGUR_SUFFIX = { thumb: 'm', card: 'l' } as const

/** What may be put in an <img>: urls of the three photo stores (transformed), and device: urls unchanged (resolved by the caller).
 *  Any other url in the data is never loaded (it would be a tracking pixel); null then. */
export function displayablePhotoUrl(url: string, size: PhotoSize): string | null {
  if (isDeviceUrl(url)) return url
  return isUploadcareUrl(url) || isCloudinaryUrl(url) || isImgurUrl(url) ? photoUrl(url, size) : null
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
