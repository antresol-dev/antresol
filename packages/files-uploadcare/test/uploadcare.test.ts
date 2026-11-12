import { FileError } from '@antresol/core'
import { describe, expect, it, vi } from 'vitest'
import { createUploadcareStore, isUploadcareCdnBase, isUploadcareUrl } from '../src/index'

const UUID = '17be4678-dab7-4bc7-8753-28914a22960a'
const KEY = 'demo-public-key'

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status })
}
const blob = () => new Blob(['x'], { type: 'image/jpeg' })

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(FileError)
    return (e as FileError).code
  }
  throw new Error('did not throw')
}

describe('createUploadcareStore', () => {
  it('requires a public key', () => {
    for (const k of ['', '   ']) {
      try {
        createUploadcareStore({ publicKey: k })
        throw new Error('did not throw')
      } catch (e) {
        expect((e as FileError).code).toBe('no_store')
      }
    }
  })

  it('posts the fields to the base upload endpoint', async () => {
    const fetchMock = vi.fn(async () => json(200, { file: UUID }))
    const store = createUploadcareStore({ publicKey: KEY, fetch: fetchMock as unknown as typeof fetch })
    expect(store.provider).toBe('uploadcare')
    await store.upload(blob(), 'a.jpg')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://upload.uploadcare.com/base/')
    expect(init.method).toBe('POST')
    const form = init.body as FormData
    expect(form.get('UPLOADCARE_PUB_KEY')).toBe(KEY)
    expect(form.get('UPLOADCARE_STORE')).toBe('1')
    expect((form.get('file') as File).name).toBe('a.jpg')
  })

  it('returns the stored file with the default CDN base', async () => {
    const store = createUploadcareStore({ publicKey: KEY, fetch: (async () => json(200, { file: UUID })) as typeof fetch })
    expect(await store.upload(blob(), 'a.jpg')).toEqual({
      provider: 'uploadcare',
      fileId: UUID,
      url: `https://ucarecdn.com/${UUID}/`,
    })
  })

  it('uses a configured CDN base, trimming trailing slashes', async () => {
    const store = createUploadcareStore({
      publicKey: KEY,
      cdnBase: 'https://abc123.ucarecd.net//',
      fetch: (async () => json(200, { file: UUID })) as typeof fetch,
    })
    expect((await store.upload(blob(), 'a.jpg')).url).toBe(`https://abc123.ucarecd.net/${UUID}/`)
  })

  it.each([
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'too_large'],
    [429, 'unavailable'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [404, 'failed'],
    [418, 'failed'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const store = createUploadcareStore({ publicKey: KEY, fetch: (async () => json(status)) as typeof fetch })
    expect(await codeOf(store.upload(blob(), 'a.jpg'))).toBe(code)
  })

  it('maps a network error to unavailable, without leaking the key', async () => {
    const store = createUploadcareStore({
      publicKey: KEY,
      fetch: (async () => {
        throw new TypeError(`Failed to fetch ${KEY}`)
      }) as typeof fetch,
    })
    try {
      await store.upload(blob(), 'a.jpg')
      throw new Error('did not throw')
    } catch (e) {
      expect((e as FileError).code).toBe('unavailable')
      expect((e as FileError).message).not.toContain(KEY)
    }
  })

  it('maps a 200 without a file id to failed', async () => {
    const store = createUploadcareStore({ publicKey: KEY, fetch: (async () => json(200, {})) as typeof fetch })
    expect(await codeOf(store.upload(blob(), 'a.jpg'))).toBe('failed')
  })

  it('times out as unavailable', async () => {
    const fetchHang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    const store = createUploadcareStore({ publicKey: KEY, fetch: fetchHang, timeoutMs: 20 })
    expect(await codeOf(store.upload(blob(), 'a.jpg'))).toBe('unavailable')
  })

  it('aborts on the caller signal as failed', async () => {
    const ctl = new AbortController()
    const fetchHang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    const store = createUploadcareStore({ publicKey: KEY, fetch: fetchHang })
    const p = store.upload(blob(), 'a.jpg', ctl.signal)
    ctl.abort()
    expect(await codeOf(p)).toBe('failed')
  })

  it.each([
    'abc123.ucarecd.net',
    'http://abc123.ucarecd.net',
    'not a url',
    'https://example.com',
    'https://cdn.example.com/ucarecdn.com',
    'https://ucarecdn.com.evil.com',
    'https://app.uploadcare.com/projects/x/delivery',
    'https://abc123.ucarecd.net/path',
  ])(
    'rejects a bad cdnBase %j with no_store before fetching',
    async (cdnBase) => {
      const fetchMock = vi.fn(async () => json(200, { file: UUID }))
      const store = createUploadcareStore({ publicKey: KEY, cdnBase, fetch: fetchMock as unknown as typeof fetch })
      expect(await codeOf(store.upload(blob(), 'a.jpg'))).toBe('no_store')
      expect(fetchMock).not.toHaveBeenCalled()
    },
  )

  it('maps a non-JSON 200 body to failed', async () => {
    const store = createUploadcareStore({
      publicKey: KEY,
      fetch: (async () => new Response('<html>', { status: 200 })) as typeof fetch,
    })
    expect(await codeOf(store.upload(blob(), 'a.jpg'))).toBe('failed')
  })

  it('maps an already aborted caller signal to failed', async () => {
    const ctl = new AbortController()
    ctl.abort()
    const fetchAbort = ((_u: string, init: RequestInit) =>
      init.signal!.aborted ? Promise.reject(new DOMException('aborted', 'AbortError')) : Promise.resolve(json(200, { file: UUID }))) as unknown as typeof fetch
    const store = createUploadcareStore({ publicKey: KEY, fetch: fetchAbort })
    expect(await codeOf(store.upload(blob(), 'a.jpg', ctl.signal))).toBe('failed')
  })
})

describe('isUploadcareCdnBase', () => {
  it.each([
    'https://ucarecdn.com',
    'https://ucarecdn.com/',
    'https://abc123.ucarecd.net',
    'https://abc123.ucarecd.net//',
  ])('accepts %j', (u) => expect(isUploadcareCdnBase(u)).toBe(true))
  it.each([
    '',
    'http://ucarecdn.com',
    'https://ucarecd.net',
    'https://evilucarecdn.com',
    'https://ucarecdn.com.evil.com',
    'https://ucarecdn.com/abc/',
    'https://ucarecdn.com:8443',
    'https://user@ucarecdn.com',
    'https://ucarecdn.com?x=1',
    'https://example.com',
  ])('rejects %j', (u) => expect(isUploadcareCdnBase(u)).toBe(false))
})

describe('isUploadcareUrl', () => {
  it('accepts photo urls on Uploadcare hosts only', () => {
    expect(isUploadcareUrl(`https://ucarecdn.com/${UUID}/`)).toBe(true)
    expect(isUploadcareUrl(`https://abc.ucarecd.net/${UUID}/`)).toBe(true)
    expect(isUploadcareUrl(`http://ucarecdn.com/${UUID}/`)).toBe(false)
    expect(isUploadcareUrl(`https://example.com/${UUID}/`)).toBe(false)
  })
})
