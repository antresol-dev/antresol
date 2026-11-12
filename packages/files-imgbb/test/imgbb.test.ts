import { FileError } from '@antresol/core'
import { describe, expect, it, vi } from 'vitest'
import { createImgbbStore, IMGBB_MEDIUM_SIDE, IMGBB_THUMB_SIDE, isImgbbUrl } from '../src/index'

const KEY = 'K'
const ORIGINAL = 'https://i.ibb.co/rR77PCpR/antresol-probe.webp'
const MEDIUM = 'https://i.ibb.co/DHVVXxMH/antresol-probe.webp'
const THUMB = 'https://i.ibb.co/fz11RhNz/antresol-probe.webp'
const DELETE = 'https://ibb.co/fz11RhNz/deadbeef'

const copy = (url: string) => ({ filename: 'antresol-probe.webp', name: 'antresol-probe', mime: 'image/webp', extension: 'webp', url })

function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    data: {
      id: 'fz11RhNz',
      url: ORIGINAL,
      display_url: MEDIUM,
      width: 2048,
      height: 1536,
      size: 196660,
      image: copy(ORIGINAL),
      thumb: copy(THUMB),
      medium: copy(MEDIUM),
      delete_url: DELETE,
      ...over,
    },
    success: true,
    status: 200,
  }
}

const respond = (b: unknown = body()) => new Response(JSON.stringify(b), { status: 200 })
const blob = () => new Blob(['x'], { type: 'image/webp' })
const make = (f: unknown, extra: { timeoutMs?: number; expirationSeconds?: number } = {}) =>
  createImgbbStore({ apiKey: KEY, fetch: f as typeof fetch, ...extra })

async function errorOf(p: Promise<unknown>): Promise<FileError> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(FileError)
    return e as FileError
  }
  throw new Error('did not throw')
}

describe('constants', () => {
  it('fits medium into 640 and thumb into a 180 square', () => {
    expect(IMGBB_MEDIUM_SIDE).toBe(640)
    expect(IMGBB_THUMB_SIDE).toBe(180)
  })
})

describe('createImgbbStore', () => {
  it('requires an api key', () => {
    for (const apiKey of ['', '  ']) {
      try {
        createImgbbStore({ apiKey })
        throw new Error('did not throw')
      } catch (e) {
        expect(e).toBeInstanceOf(FileError)
        expect((e as FileError).code).toBe('no_store')
      }
    }
  })

  it('posts the image to the upload endpoint with the key in the query', async () => {
    const f = vi.fn(async () => respond())
    const store = make(f)
    expect(store.provider).toBe('imgbb')
    await store.upload(blob(), 'photo.webp')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.imgbb.com/1/upload?key=K')
    expect(init.method).toBe('POST')
    expect(((init.body as FormData).get('image') as File).name).toBe('photo.webp')
  })

  it('adds expiration only when asked to', async () => {
    const f = vi.fn(async () => respond())
    await make(f, { expirationSeconds: 600 }).upload(blob(), 'photo.webp')
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.imgbb.com/1/upload?key=K&expiration=600')
  })

  it('returns the file with every rendition and the delete link', async () => {
    const stored = await make(async () => respond()).upload(blob(), 'photo.webp')
    expect(stored).toEqual({
      provider: 'imgbb',
      fileId: 'fz11RhNz',
      url: ORIGINAL,
      urls: [
        { url: ORIGINAL, role: 'original', width: 2048, height: 1536, fit: 'inside', type: 'image/webp' },
        { url: MEDIUM, role: 'medium', width: 640, height: 480, fit: 'inside', type: 'image/webp' },
        { url: THUMB, role: 'thumb', width: 180, height: 180, fit: 'cover', type: 'image/webp' },
      ],
      deleteHandle: DELETE,
    })
  })

  it('reads width and height given as strings', async () => {
    const stored = await make(async () => respond(body({ width: '2048', height: '1536' }))).upload(blob(), 'a')
    expect(stored.urls?.[0]).toMatchObject({ width: 2048, height: 1536 })
    expect(stored.urls?.[1]).toMatchObject({ width: 640, height: 480 })
  })

  it('keeps only the original when medium and thumb are absent', async () => {
    const stored = await make(async () => respond(body({ medium: undefined, thumb: undefined }))).upload(blob(), 'a')
    expect(stored.urls).toEqual([
      { url: ORIGINAL, role: 'original', width: 2048, height: 1536, fit: 'inside', type: 'image/webp' },
    ])
  })

  it('does not enlarge a small original for medium', async () => {
    const stored = await make(async () => respond(body({ width: 500, height: 300 }))).upload(blob(), 'a')
    expect(stored.urls?.[1]).toMatchObject({ role: 'medium', width: 500, height: 300, fit: 'inside' })
  })

  it('drops a thumb hosted elsewhere and keeps the rest', async () => {
    const stored = await make(async () =>
      respond(body({ thumb: copy('https://evil.example/t.webp') })),
    ).upload(blob(), 'a')
    expect(stored.urls?.map((r) => r.role)).toEqual(['original', 'medium'])
  })

  it('falls back to data.url when image.url is missing', async () => {
    const stored = await make(async () => respond(body({ image: undefined }))).upload(blob(), 'a')
    expect(stored.url).toBe(ORIGINAL)
    expect(stored.urls?.[0]).toMatchObject({ role: 'original', type: null })
  })

  it('gives a null delete handle when there is no delete_url', async () => {
    const stored = await make(async () => respond(body({ delete_url: undefined }))).upload(blob(), 'a')
    expect(stored.deleteHandle).toBeNull()
  })

  it('fails when the original URL is not an ImgBB photo URL', async () => {
    const e = await errorOf(make(async () => respond(body({ image: copy('https://evil.example/a.webp'), url: 'https://evil.example/a.webp' }))).upload(blob(), 'a'))
    expect(e.code).toBe('failed')
  })

  it('fails when the original size is not readable', async () => {
    const e = await errorOf(make(async () => respond(body({ width: 'wide' }))).upload(blob(), 'a'))
    expect(e.code).toBe('failed')
  })

  it('fails when the id is missing', async () => {
    const e = await errorOf(make(async () => respond(body({ id: undefined }))).upload(blob(), 'a'))
    expect(e.code).toBe('failed')
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [403, 'rejected'],
    [413, 'too_large'],
    [429, 'unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [418, 'failed'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const e = await errorOf(make(async () => new Response('{}', { status })).upload(blob(), 'a'))
    expect(e.code).toBe(code)
    expect(e.message).not.toContain(KEY + '&')
  })

  it('maps a network error to unavailable without leaking the key', async () => {
    const secret = 'sEcReT-key'
    const store = createImgbbStore({
      apiKey: secret,
      fetch: (async () => {
        throw new TypeError(`Failed to fetch https://api.imgbb.com/1/upload?key=${secret}`)
      }) as unknown as typeof fetch,
    })
    const e = await errorOf(store.upload(blob(), 'a'))
    expect(e.code).toBe('unavailable')
    expect(e.message).not.toContain(secret)
    expect(String(e.cause ?? '')).not.toContain(secret)
  })

  it('maps a timeout to unavailable', async () => {
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
    const e = await errorOf(make(f, { timeoutMs: 5 }).upload(blob(), 'a'))
    expect(e.code).toBe('unavailable')
  })

  it('maps a caller abort to failed', async () => {
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))))
    const ctl = new AbortController()
    const p = make(f).upload(blob(), 'a', ctl.signal)
    ctl.abort()
    expect((await errorOf(p)).code).toBe('failed')
  })

  it('maps a non-JSON answer to failed', async () => {
    const e = await errorOf(make(async () => new Response('<html>', { status: 200 })).upload(blob(), 'a'))
    expect(e.code).toBe('failed')
  })
})

describe('isImgbbUrl', () => {
  it('accepts a photo URL on i.ibb.co', () => {
    expect(isImgbbUrl(ORIGINAL)).toBe(true)
    expect(isImgbbUrl('https://i.ibb.co/abc123/photo.jpeg')).toBe(true)
  })

  it.each([
    ['http scheme', 'http://i.ibb.co/rR77PCpR/a.webp'],
    ['another host', 'https://i.imgur.com/rR77PCpR/a.webp'],
    ['no id in the path', 'https://i.ibb.co/a.webp'],
    ['a port', 'https://i.ibb.co:8443/rR77PCpR/a.webp'],
    ['credentials', 'https://user:pw@i.ibb.co/rR77PCpR/a.webp'],
    ['an unknown extension', 'https://i.ibb.co/rR77PCpR/a.svg'],
    ['not a URL', 'nope'],
  ])('rejects %s', (_name, url) => {
    expect(isImgbbUrl(url)).toBe(false)
  })
})
