import { FileError } from '@graymatter/core'
import { describe, expect, it, vi } from 'vitest'
import { cloudinaryThumbUrl, createCloudinaryStore, isCloudinaryUrl } from '../src/index'

const URL_ = 'https://res.cloudinary.com/demo/image/upload/v1/abc.jpg'
const ok = () => new Response(JSON.stringify({ public_id: 'abc', secure_url: URL_ }), { status: 200 })
const blob = () => new Blob(['x'], { type: 'image/jpeg' })
const make = (f: unknown) => createCloudinaryStore({ cloudName: 'demo', uploadPreset: 'pre', fetch: f as typeof fetch })

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(FileError)
    return (e as FileError).code
  }
  throw new Error('did not throw')
}

describe('createCloudinaryStore', () => {
  it('requires cloud name and preset', () => {
    for (const [c, p] of [['', 'p'], ['c', ' '], ['a/b', 'p']]) {
      expect(() => createCloudinaryStore({ cloudName: c!, uploadPreset: p! })).toThrow(FileError)
    }
  })

  it('posts file and preset unsigned to the cloud endpoint and returns the stored file', async () => {
    const f = vi.fn(async () => ok())
    const store = make(f)
    expect(store.provider).toBe('cloudinary')
    expect(await store.upload(blob(), 'a.jpg')).toEqual({ provider: 'cloudinary', fileId: 'abc', url: URL_ })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo/image/upload')
    const form = init.body as FormData
    expect(form.get('upload_preset')).toBe('pre')
    expect((form.get('file') as File).name).toBe('a.jpg')
  })

  it.each([
    [400, 'rejected'],
    [401, 'rejected'],
    [413, 'too_large'],
    [420, 'unavailable'],
    [500, 'unavailable'],
    [404, 'failed'],
  ])('maps HTTP %i to %s', async (status, code) => {
    expect(await codeOf(make(async () => new Response('{}', { status })).upload(blob(), 'a.jpg'))).toBe(code)
  })

  it('maps a network error to unavailable without leaking the preset', async () => {
    const store = make(async () => {
      throw new TypeError('Failed to fetch pre')
    })
    try {
      await store.upload(blob(), 'a.jpg')
      throw new Error('did not throw')
    } catch (e) {
      expect((e as FileError).code).toBe('unavailable')
      expect((e as FileError).message).not.toContain('pre')
    }
  })

  it('maps a bad 200 body to failed', async () => {
    expect(await codeOf(make(async () => new Response('{}', { status: 200 })).upload(blob(), 'a'))).toBe('failed')
    expect(await codeOf(make(async () => new Response('<html>', { status: 200 })).upload(blob(), 'a'))).toBe('failed')
  })

  it('times out as unavailable and aborts as failed', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    expect(await codeOf(createCloudinaryStore({ cloudName: 'd', uploadPreset: 'p', fetch: hang, timeoutMs: 20 }).upload(blob(), 'a'))).toBe('unavailable')
    const ctl = new AbortController()
    const p = createCloudinaryStore({ cloudName: 'd', uploadPreset: 'p', fetch: hang }).upload(blob(), 'a', ctl.signal)
    ctl.abort()
    expect(await codeOf(p)).toBe('failed')
  })
})

describe('urls', () => {
  it('recognises Cloudinary delivery urls only', () => {
    expect(isCloudinaryUrl(URL_)).toBe(true)
    expect(isCloudinaryUrl('http://res.cloudinary.com/demo/image/upload/a.jpg')).toBe(false)
    expect(isCloudinaryUrl('https://evil.com/demo/image/upload/a.jpg')).toBe(false)
    expect(isCloudinaryUrl('https://res.cloudinary.com/demo/video/upload/a.mp4')).toBe(false)
  })
  it('inserts the transformation after /upload/', () => {
    expect(cloudinaryThumbUrl(URL_, 400)).toBe('https://res.cloudinary.com/demo/image/upload/w_400,c_limit,f_auto,q_auto/v1/abc.jpg')
    expect(cloudinaryThumbUrl('https://x.com/a', 400)).toBe('https://x.com/a')
  })
})
