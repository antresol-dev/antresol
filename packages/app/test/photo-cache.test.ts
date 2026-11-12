import { afterEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('defineNuxtConfig', <T>(config: T) => config)
const { default: config } = await import('../nuxt.config')
const { clearPhotoCache, PHOTO_CACHE, photoCacheSize, photoCrossorigin } = await import('../app/lib/photo-cache')
const { displayablePhotoUrl, photoUrl } = await import('../app/lib/photo-url')

interface Rule {
  urlPattern: RegExp
  handler: string
  options: { cacheName: string; expiration: { maxEntries: number }; cacheableResponse: { statuses: number[] } }
}
const rules = config.pwa?.workbox?.runtimeCaching as unknown as Rule[]
const ruleFor = (url: string): Rule | undefined => rules.find((r) => r.urlPattern.test(url))

const UC = 'https://ucarecdn.com/abc/'
const CL = 'https://res.cloudinary.com/demo/image/upload/v1/abc.jpg'
const IM = 'https://i.imgur.com/Ab1.jpg'

describe('photo runtime caching', () => {
  it('is cache-first, 200 only (never opaque), with 600 thumbnails and 150 big photos (plus the font cache)', () => {
    expect(rules.map((r) => [r.options.cacheName, r.options.expiration.maxEntries])).toEqual([
      [PHOTO_CACHE.thumbs, 600],
      [PHOTO_CACHE.full, 150],
      ['antresol-fonts', 60], // style fonts (test/fonts.test.ts), after the photo rules
    ])
    for (const r of rules) {
      expect(r.handler).toBe('CacheFirst')
      expect(r.options.cacheableResponse).toEqual({ statuses: [200] })
    }
  })
  it('puts thumbnails of every store in the thumbnail cache and bigger sizes in the other', () => {
    for (const u of [UC, CL, IM, 'https://abc.ucarecd.net/abc/']) {
      expect(ruleFor(photoUrl(u, 'thumb'))?.options.cacheName).toBe(PHOTO_CACHE.thumbs)
      expect(ruleFor(photoUrl(u, 'card'))?.options.cacheName).toBe(PHOTO_CACHE.full)
      expect(ruleFor(photoUrl(u, 'full'))?.options.cacheName).toBe(PHOTO_CACHE.full)
    }
  })
  it('caches a marked ImgBB copy with the thumbnails and an unmarked one with the big photos', () => {
    const marked = 'https://i.ibb.co/Ab1/thumb.webp?antresol=thumb'
    expect(ruleFor(marked)?.options.cacheName).toBe(PHOTO_CACHE.thumbs)
    expect(ruleFor('https://i.ibb.co/Ab1/medium.webp')?.options.cacheName).toBe(PHOTO_CACHE.full)
    expect(ruleFor('https://i.ibb.co/Ab1/thumb.webp?other=1')?.options.cacheName).toBe(PHOTO_CACHE.full)
    expect(ruleFor('https://i.ibb.co/Ab1/thumb.webp?antresol=thumb&x=1')?.options.cacheName).toBe(PHOTO_CACHE.full)
  })
  it('sends what displayablePhotoUrl gives for an ImgBB photo to the right cache, fetched with CORS', () => {
    const copy = (name: string, side: number, fit: 'inside' | 'cover') => ({
      url: `https://i.ibb.co/Ab1/${name}.webp`, role: name, width: side, height: side, fit, type: 'image/webp',
    })
    const photo = { url: 'https://i.ibb.co/Ab0/photo.webp', urls: [copy('original', 2048, 'inside'), copy('medium', 640, 'inside'), copy('thumb', 180, 'cover')] }
    const thumb = displayablePhotoUrl(photo, 'thumb')!
    const full = displayablePhotoUrl(photo, 'full')!
    expect(ruleFor(thumb)?.options.cacheName).toBe(PHOTO_CACHE.thumbs)
    expect(ruleFor(full)?.options.cacheName).toBe(PHOTO_CACHE.full)
    // The cache keeps only real (CORS) responses: the marked copy is still one of the stores' photos.
    expect(photoCrossorigin(thumb)).toBe('anonymous')
    expect(photoCrossorigin(full)).toBe('anonymous')
  })
  it('leaves every other address alone (uploads, API, the app itself)', () => {
    for (const u of [
      'https://upload.uploadcare.com/base/',
      'https://api.cloudinary.com/v1_1/x/image/upload',
      'https://api.imgur.com/3/image',
      'https://api.imgbb.com/1/upload',
      'https://i.ibb.co.evil.test/a/b.webp',
      'https://example.com/ucarecdn.com/a.jpg',
      'https://ucarecdn.com.evil.test/a.jpg',
      'http://ucarecdn.com/a/',
      'https://x.neon.tech/sql',
    ]) {
      expect(ruleFor(u), u).toBeUndefined()
    }
  })
})

describe('photoCrossorigin', () => {
  it('asks the four stores with CORS and nothing else', () => {
    expect(photoCrossorigin(UC)).toBe('anonymous')
    expect(photoCrossorigin(CL)).toBe('anonymous')
    expect(photoCrossorigin(IM)).toBe('anonymous')
    expect(photoCrossorigin('https://i.ibb.co/Ab1/photo.webp')).toBe('anonymous')
    // The app's own thumbnail cache mark, and nothing else after the file name.
    expect(photoCrossorigin('https://i.ibb.co/Ab1/photo.webp?antresol=thumb')).toBe('anonymous')
    expect(photoCrossorigin('https://i.ibb.co/Ab1/photo.webp?other=1')).toBeUndefined()
    expect(photoCrossorigin('https://evil.example/p.jpg?antresol=thumb')).toBeUndefined()
    expect(photoCrossorigin('device:x')).toBeUndefined()
    expect(photoCrossorigin('https://example.com/a.jpg')).toBeUndefined()
  })
})

describe('photo cache size and clearing', () => {
  afterEach(() => vi.unstubAllGlobals())
  const fakeCaches = (store: Record<string, Record<string, number>>) => ({
    open: async (name: string) => ({
      keys: async () => Object.keys((store[name] ??= {})),
      match: async (k: string) => ({ headers: new Headers(), blob: async () => ({ size: store[name]![k] }) }),
    }),
    delete: async (name: string) => Reflect.deleteProperty(store, name),
  })
  it('sums both caches and clears them', async () => {
    const store = { [PHOTO_CACHE.thumbs]: { a: 10, b: 20 }, [PHOTO_CACHE.full]: { c: 300 } }
    vi.stubGlobal('caches', fakeCaches(store))
    expect(await photoCacheSize()).toBe(330)
    await clearPhotoCache()
    expect(store).toEqual({})
    expect(await photoCacheSize()).toBe(0)
  })
  it('reads the size from content-length and the body only where the header is missing', async () => {
    const blob = vi.fn(async () => ({ size: 7 }))
    const response = (length: string | null) => ({ headers: new Headers(length === null ? {} : { 'content-length': length }), blob })
    const store: Record<string, ReturnType<typeof response>> = { a: response('1000'), b: response(null), c: response('2000') }
    vi.stubGlobal('caches', {
      open: async (name: string) => ({
        keys: async () => (name === PHOTO_CACHE.thumbs ? Object.keys(store) : []),
        match: async (k: string) => store[k],
      }),
    })
    expect(await photoCacheSize()).toBe(3007)
    expect(blob).toHaveBeenCalledTimes(1)
  })
  it('reports 0 and does nothing without the Cache API', async () => {
    expect(await photoCacheSize()).toBe(0)
    await expect(clearPhotoCache()).resolves.toBeUndefined()
  })
})
