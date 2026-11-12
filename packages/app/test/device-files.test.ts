import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createStore, set } from 'idb-keyval'
import { createDeviceFileStore, releaseDeviceUrls, resolveDeviceUrl } from '../app/lib/device-files'
import { isDeviceUrl } from '../app/lib/photo-url'

let counter = 0
let create: MockInstance<(obj: Blob | MediaSource) => string>
let revoke: MockInstance<(url: string) => void>

beforeEach(() => {
  counter = 0
  create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test/${++counter}`)
  revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  releaseDeviceUrls()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('device file store', () => {
  it('uploads a blob under a device url and resolves it once per id', async () => {
    const stored = await createDeviceFileStore().upload(new Blob(['x'], { type: 'image/jpeg' }), 'a.jpg')
    expect(stored.provider).toBe('device')
    expect(stored.url).toBe(`device:${stored.fileId}`)
    expect(isDeviceUrl(stored.url)).toBe(true)
    const [a, b] = await Promise.all([resolveDeviceUrl(stored.url), resolveDeviceUrl(stored.url)])
    expect(a).toBe('blob:test/1')
    expect(b).toBe(a)
    expect(await resolveDeviceUrl(stored.url)).toBe(a)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('returns null for an unknown id', async () => {
    expect(await resolveDeviceUrl('device:missing')).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('releaseDeviceUrls revokes all cached urls', async () => {
    const store = createDeviceFileStore()
    const one = await store.upload(new Blob(['1']), '1.jpg')
    const two = await store.upload(new Blob(['2']), '2.jpg')
    await resolveDeviceUrl(one.url)
    await resolveDeviceUrl(two.url)
    releaseDeviceUrls()
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:test/1', 'blob:test/2'])
    await resolveDeviceUrl(one.url)
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('does not cache a miss', async () => {
    const id = 'late-file'
    expect(await resolveDeviceUrl(`device:${id}`)).toBeNull()
    await set(id, new Blob(['x']), createStore('antresol-files', 'files'))
    expect(await resolveDeviceUrl(`device:${id}`)).toBe('blob:test/1')
  })

  it('returns null for an url released before the read settled, and revokes it', async () => {
    const stored = await createDeviceFileStore().upload(new Blob(['x']), 'a.jpg')
    const pending = resolveDeviceUrl(stored.url)
    releaseDeviceUrls()
    expect(await pending).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:test/1')
  })

  it('without IndexedDB: resolve gives null, upload rejects as unavailable', async () => {
    vi.resetModules()
    vi.stubGlobal('indexedDB', undefined)
    const fresh = await import('../app/lib/device-files')
    expect(await fresh.resolveDeviceUrl('device:x')).toBeNull()
    await expect(fresh.createDeviceFileStore().upload(new Blob(['x']), 'a.jpg')).rejects.toMatchObject({
      name: 'FileError',
      code: 'unavailable',
    })
  })
})
