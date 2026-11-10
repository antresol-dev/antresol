import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeviceFileStore, releaseDeviceUrls, resolveDeviceUrl } from '../app/lib/device-files'
import { isDeviceUrl } from '../app/lib/photo-url'

let counter = 0
const create = vi.fn(() => `blob:test/${++counter}`)
const revoke = vi.fn()

beforeEach(() => {
  counter = 0
  create.mockClear()
  revoke.mockClear()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
})
afterEach(() => {
  releaseDeviceUrls()
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
})
