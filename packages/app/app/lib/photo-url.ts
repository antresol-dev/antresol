export type PhotoSize = 'thumb' | 'card' | 'full'

const SIDE: Record<PhotoSize, number> = { thumb: 160, card: 800, full: 2048 }

export function isUploadcareUrl(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  return u.protocol === 'https:' && (u.hostname === 'ucarecdn.com' || u.hostname.endsWith('.ucarecd.net'))
}

export function isDeviceUrl(url: string): boolean {
  return url.startsWith('device:')
}

/** What may be put in an <img>: Uploadcare urls (transformed), and device: urls unchanged (resolved by the caller).
 *  Any other url in the data is never loaded (it would be a tracking pixel); null then. */
export function displayablePhotoUrl(url: string, size: PhotoSize): string | null {
  if (isDeviceUrl(url)) return url
  return isUploadcareUrl(url) ? photoUrl(url, size) : null
}

/** Uploadcare: preview transformation appended to the base (which ends with '/'); other URLs unchanged. */
export function photoUrl(url: string, size: PhotoSize): string {
  if (!isUploadcareUrl(url)) return url
  const n = SIDE[size]
  const base = url.endsWith('/') ? url : `${url}/`
  return `${base}-/preview/${n}x${n}/-/format/auto/-/quality/smart/`
}
