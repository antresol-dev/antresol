import { FileError } from '@graymatter/core'
import { describe, expect, it, vi } from 'vitest'
import { createImgurStore, imgurThumbUrl, isImgurUrl } from '../src/index'

const ok = () => new Response(JSON.stringify({ data: { id: 'Ab1', link: 'https://i.imgur.com/Ab1.jpg' }, success: true }), { status: 200 })
const blob = () => new Blob(['x'], { type: 'image/jpeg' })
const make = (f: unknown) => createImgurStore({ clientId: 'cid123', fetch: f as typeof fetch })

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(FileError)
    return (e as FileError).code
  }
  throw new Error('did not throw')
}

describe('createImgurStore', () => {
  it('requires a client id', () => {
    expect(() => createImgurStore({ clientId: '  ' })).toThrow(FileError)
  })

  it('posts the image anonymously with the Client-ID header and returns the stored file', async () => {
    const f = vi.fn(async () => ok())
    const store = make(f)
    expect(store.provider).toBe('imgur')
    expect(await store.upload(blob(), 'a.jpg')).toEqual({ provider: 'imgur', fileId: 'Ab1', url: 'https://i.imgur.com/Ab1.jpg' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.imgur.com/3/image')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Client-ID cid123')
    expect(((init.body as FormData).get('image') as File).name).toBe('a.jpg')
  })

  it('upgrades an http link to https', async () => {
    const store = make(async () => new Response(JSON.stringify({ data: { id: 'x', link: 'http://i.imgur.com/x.png' } }), { status: 200 }))
    expect((await store.upload(blob(), 'a')).url).toBe('https://i.imgur.com/x.png')
  })

  it.each([
    [400, 'rejected'],
    [403, 'rejected'],
    [413, 'too_large'],
    [429, 'unavailable'],
    [503, 'unavailable'],
    [404, 'failed'],
  ])('maps HTTP %i to %s', async (status, code) => {
    expect(await codeOf(make(async () => new Response('{}', { status })).upload(blob(), 'a'))).toBe(code)
  })

  it('maps a network error to unavailable without leaking the client id', async () => {
    const store = make(async () => {
      throw new TypeError('Failed to fetch cid123')
    })
    try {
      await store.upload(blob(), 'a')
      throw new Error('did not throw')
    } catch (e) {
      expect((e as FileError).code).toBe('unavailable')
      expect((e as FileError).message).not.toContain('cid123')
    }
  })

  it('maps a bad 200 body to failed', async () => {
    expect(await codeOf(make(async () => new Response('{}', { status: 200 })).upload(blob(), 'a'))).toBe('failed')
    const foreign = new Response(JSON.stringify({ data: { id: 'x', link: 'https://evil.com/x.jpg' } }), { status: 200 })
    expect(await codeOf(make(async () => foreign).upload(blob(), 'a'))).toBe('failed')
  })

  it('times out as unavailable and aborts as failed', async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => {
        init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch
    expect(await codeOf(createImgurStore({ clientId: 'c', fetch: hang, timeoutMs: 20 }).upload(blob(), 'a'))).toBe('unavailable')
    const ctl = new AbortController()
    const p = createImgurStore({ clientId: 'c', fetch: hang }).upload(blob(), 'a', ctl.signal)
    ctl.abort()
    expect(await codeOf(p)).toBe('failed')
  })
})

describe('urls', () => {
  it('recognises Imgur photo urls only', () => {
    expect(isImgurUrl('https://i.imgur.com/Ab1.jpg')).toBe(true)
    expect(isImgurUrl('http://i.imgur.com/Ab1.jpg')).toBe(false)
    expect(isImgurUrl('https://imgur.com/Ab1')).toBe(false)
    expect(isImgurUrl('https://i.imgur.com.evil.com/Ab1.jpg')).toBe(false)
  })
  it('puts the size letter before the extension', () => {
    expect(imgurThumbUrl('https://i.imgur.com/Ab1.jpg', 'm')).toBe('https://i.imgur.com/Ab1m.jpg')
    expect(imgurThumbUrl('https://i.imgur.com/Ab1.png', 'l')).toBe('https://i.imgur.com/Ab1l.png')
    expect(imgurThumbUrl('https://x.com/a.jpg', 'm')).toBe('https://x.com/a.jpg')
  })
})
