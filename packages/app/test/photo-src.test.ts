import type { Rendition } from '@antresol/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, type EffectScope } from 'vue'
import type { PhotoRef, PhotoSize } from '../app/lib/photo-url'

// A device lookup answers a timer tick later, as IndexedDB does: the placeholder in between can be seen.
const resolveDeviceUrl = vi.hoisted(() =>
  vi.fn((url: string) => new Promise<string | null>((resolve) => setTimeout(() => resolve(`blob:${url}`), 0))),
)
vi.mock('~/lib/device-files', () => ({ resolveDeviceUrl }))
vi.mock('~/lib/photo-url', () => import('../app/lib/photo-url'))
const { usePhotoSrc } = await import('../app/composables/usePhotoSrc')

const scopes: EffectScope[] = []
afterEach(() => {
  for (const s of scopes.splice(0)) s.stop()
  resolveDeviceUrl.mockClear()
})

/** PhotoImg's props, in an effect scope of their own, and what it shows. */
function mount(photo: PhotoRef, size: PhotoSize = 'thumb') {
  const props = reactive({ photo, size })
  const scope = effectScope()
  scopes.push(scope)
  const shown = scope.run(() => usePhotoSrc(props))!
  return { props, ...shown }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

const copy = (name: string, side: number, fit: Rendition['fit']): Rendition => ({
  url: `https://i.ibb.co/c/${name}.webp`, role: name, width: side, height: side, fit, type: 'image/webp',
})
const COPIES = [copy('o', 2048, 'inside'), copy('m', 640, 'inside'), copy('t', 180, 'cover')]

describe('usePhotoSrc', () => {
  it('keeps a device photo on screen when the PhotoRef is rebuilt with the same url (every write rebuilds the covers)', async () => {
    const { props, src } = mount({ url: 'device:a', urls: null })
    await settle()
    expect(src.value).toBe('blob:device:a')
    props.photo = { url: 'device:a', urls: null }
    await nextTick()
    // No placeholder in between, no second lookup.
    expect(src.value).toBe('blob:device:a')
    await settle()
    expect(src.value).toBe('blob:device:a')
    expect(resolveDeviceUrl).toHaveBeenCalledTimes(1)
  })

  it('looks again when the url, the renditions or the size change', async () => {
    const { props, src } = mount({ url: 'device:a', urls: null })
    await settle()
    props.photo = { url: 'device:b', urls: null }
    await nextTick()
    expect(src.value).toBeNull()
    await settle()
    expect(src.value).toBe('blob:device:b')

    props.photo = { url: 'https://i.ibb.co/p/photo.webp', urls: COPIES }
    await nextTick()
    expect(src.value).toBe('https://i.ibb.co/c/t.webp?antresol=thumb')
    props.photo = { url: 'https://i.ibb.co/p/photo.webp', urls: COPIES.slice(0, 2) }
    await nextTick()
    expect(src.value).toBe('https://i.ibb.co/c/m.webp')
    props.size = 'full'
    await nextTick()
    expect(src.value).toBe('https://i.ibb.co/c/o.webp')
  })

  it('fails without loading a url of no photo store, and a device photo that is gone', async () => {
    const foreign = mount({ url: 'https://example.com/p.jpg', urls: null })
    expect(foreign.src.value).toBeNull()
    expect(foreign.failed.value).toBe(true)
    resolveDeviceUrl.mockResolvedValueOnce(null)
    const gone = mount({ url: 'device:x', urls: null })
    await settle()
    expect(gone.src.value).toBeNull()
    expect(gone.failed.value).toBe(true)
  })

  it('ignores the answer for a device url it has moved on from', async () => {
    const { props, src } = mount({ url: 'device:slow', urls: null })
    props.photo = { url: 'https://i.ibb.co/p/photo.webp', urls: null }
    await nextTick()
    await settle()
    expect(src.value).toBe('https://i.ibb.co/p/photo.webp')
  })
})
