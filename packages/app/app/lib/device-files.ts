import { newId, type FileStore, type StoredFile } from '@graymatter/core'
import { createStore, get, set, type UseStore } from 'idb-keyval'

const PROVIDER = 'device'
const PREFIX = 'device:'

let store: UseStore | null = null
const files = (): UseStore => (store ??= createStore('gm-files', 'files'))

// Promises, so concurrent calls for one id share a single object URL.
const cache = new Map<string, Promise<string | null>>()
const made = new Set<string>()
let generation = 0

/** Blobs in IndexedDB (idb-keyval store 'gm-files'/'files'); provider 'device', fileId = newId(), url = 'device:<fileId>'. */
export function createDeviceFileStore(): FileStore {
  return {
    provider: PROVIDER,
    async upload(file: Blob): Promise<StoredFile> {
      const fileId = newId()
      await set(fileId, file, files())
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
  const pending = get<Blob>(id, files()).then((blob) => {
    if (!blob) {
      // Do not cache a miss: the photo may be stored later.
      if (cache.get(id) === pending) cache.delete(id)
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
  pending.catch(() => {
    if (cache.get(id) === pending) cache.delete(id)
  })
  cache.set(id, pending)
  return pending
}

/** Revokes all cached object URLs (on source removal / tests). */
export function releaseDeviceUrls(): void {
  generation++
  for (const objectUrl of made) URL.revokeObjectURL(objectUrl)
  made.clear()
  cache.clear()
}
