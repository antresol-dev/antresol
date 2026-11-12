import { isCloudinaryUrl, isImgurUrl, isUploadcareUrl } from './photo-url'

/** Cache names of the service worker's photo caches (nuxt.config.ts pwa.workbox.runtimeCaching uses the same names). */
export const PHOTO_CACHE = { thumbs: 'antresol-photos-thumb', full: 'antresol-photos-full' } as const

/** The three stores send `Access-Control-Allow-Origin: *`, so their photos are fetched with CORS: the service worker then
 *  caches real (non-opaque) responses. Device and foreign urls are never loaded this way. */
export function photoCrossorigin(url: string): 'anonymous' | undefined {
  return isUploadcareUrl(url) || isCloudinaryUrl(url) || isImgurUrl(url) ? 'anonymous' : undefined
}

async function openCaches(): Promise<Cache[]> {
  if (typeof caches === 'undefined') return []
  return Promise.all(Object.values(PHOTO_CACHE).map((name) => caches.open(name)))
}

/** Bytes of a cached response: its content-length, or (only where that header is missing) the body read in full. */
async function sizeOf(response: Response): Promise<number> {
  const header = response.headers.get('content-length')
  const length = header === null || header.trim() === '' ? NaN : Number(header)
  return Number.isSafeInteger(length) && length >= 0 ? length : (await response.blob()).size
}

/** Bytes held by the photo caches on this device (0 where there is no Cache API). */
export async function photoCacheSize(): Promise<number> {
  try {
    let total = 0
    for (const cache of await openCaches()) {
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        if (response) total += await sizeOf(response)
      }
    }
    return total
  } catch {
    return 0
  }
}

export async function clearPhotoCache(): Promise<void> {
  if (typeof caches === 'undefined') return
  await Promise.all(Object.values(PHOTO_CACHE).map((name) => caches.delete(name)))
}
