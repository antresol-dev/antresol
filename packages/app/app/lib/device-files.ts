import { FileError, newId, type FileStore, type StoredFile } from '@antresol/core'
import { createStore, get, set, type UseStore } from 'idb-keyval'

const PROVIDER = 'device'
const PREFIX = 'device:'

let store: UseStore | null = null
const files = (): UseStore => (store ??= createStore('antresol-files', 'files'))

// Promises, so concurrent calls for one id share a single object URL.
const cache = new Map<string, Promise<string | null>>()
const made = new Set<string>()
let generation = 0

/** Blobs in IndexedDB (idb-keyval store 'antresol-files'/'files'); provider 'device', fileId = newId(), url = 'device:<fileId>'. */
export function createDeviceFileStore(): FileStore {
  return {
    provider: PROVIDER,
    async upload(file: Blob): Promise<StoredFile> {
      const fileId = newId()
      try {
        await set(fileId, file, files())
      } catch {
        throw new FileError('unavailable')
      }
      return { provider: PROVIDER, fileId, url: `${PREFIX}${fileId}` }
    },
  }
}

/** Object URL for a device photo, created once per id and cached; null when missing. */
export function resolveDeviceUrl(url: string): Promise<string | null> {
  const id = url.startsWith(PREFIX) ? url.slice(PREFIX.length) : url
  const cached = cache.get(id)
  if (cached) return cached
  const gen = generation
  // Deferred, so a missing IndexedDB (sync throw) becomes a rejection handled below.
  const pending = Promise.resolve().then(() => get<Blob>(id, files())).then((blob) => {
    if (!blob) {
      // Do not cache a miss: the photo may be stored later.
      if (cache.get(id) === safe) cache.delete(id)
      return null
    }
    const objectUrl = URL.createObjectURL(blob)
    if (gen !== generation) {
      URL.revokeObjectURL(objectUrl)
      return null
    }
    made.add(objectUrl)
    return objectUrl
  })
  const safe = pending.catch(() => {
    if (cache.get(id) === safe) cache.delete(id)
    return null
  })
  cache.set(id, safe)
  return safe
}

/** Revokes all cached object URLs (on source removal / tests). */
export function releaseDeviceUrls(): void {
  generation++
  for (const objectUrl of made) URL.revokeObjectURL(objectUrl)
  made.clear()
  cache.clear()
}
