import { describe, expect, it } from 'vitest'
import type { Rendition } from '@antresol/core'
import { displayablePhotoUrl, isDeviceUrl, isUploadcareUrl, pickRendition, photoUrl } from '../app/lib/photo-url'

describe('photoUrl', () => {
  it('builds Uploadcare transformations per size', () => {
    expect(photoUrl('https://ucarecdn.com/abc/', 'thumb')).toBe(
      'https://ucarecdn.com/abc/-/preview/160x160/-/format/auto/-/quality/smart/',
    )
    expect(photoUrl('https://ucarecdn.com/abc/', 'card')).toContain('/-/preview/800x800/')
    expect(photoUrl('https://ucarecdn.com/abc/', 'full')).toContain('/-/preview/2048x2048/')
  })
  it('leaves device and foreign urls unchanged', () => {
    expect(photoUrl('device:x', 'thumb')).toBe('device:x')
    expect(photoUrl('https://example.com/a.jpg', 'thumb')).toBe('https://example.com/a.jpg')
  })
})

describe('photoUrl by provider', () => {
  it('builds Cloudinary transformations per size', () => {
    const u = 'https://res.cloudinary.com/demo/image/upload/v1/abc.jpg'
    expect(photoUrl(u, 'thumb')).toBe('https://res.cloudinary.com/demo/image/upload/w_400,c_limit,f_auto,q_auto/v1/abc.jpg')
    expect(photoUrl(u, 'card')).toContain('/upload/w_800,c_limit')
    expect(photoUrl(u, 'full')).toContain('/upload/w_2048,c_limit')
  })
  it('builds Imgur size suffixes per size', () => {
    expect(photoUrl('https://i.imgur.com/Ab1.jpg', 'thumb')).toBe('https://i.imgur.com/Ab1m.jpg')
    expect(photoUrl('https://i.imgur.com/Ab1.jpg', 'card')).toBe('https://i.imgur.com/Ab1l.jpg')
    expect(photoUrl('https://i.imgur.com/Ab1.jpg', 'full')).toBe('https://i.imgur.com/Ab1.jpg')
  })
  it('displays photos of every store and still refuses foreign hosts', () => {
    expect(displayablePhotoUrl({ url: 'https://i.imgur.com/Ab1.jpg' }, 'thumb')).toBe('https://i.imgur.com/Ab1m.jpg')
    expect(displayablePhotoUrl({ url: 'https://res.cloudinary.com/d/image/upload/a.jpg' }, 'thumb')).toContain('w_400')
    expect(displayablePhotoUrl({ url: 'https://res.cloudinary.com.evil.com/d/image/upload/a.jpg' }, 'thumb')).toBeNull()
  })
})

describe('displayablePhotoUrl', () => {
  it('allows Uploadcare and device urls only', () => {
    expect(displayablePhotoUrl({ url: 'https://ucarecdn.com/abc/' }, 'card')).toContain('/-/preview/800x800/')
    expect(displayablePhotoUrl({ url: 'device:x' }, 'thumb')).toBe('device:x')
    expect(displayablePhotoUrl({ url: 'https://example.com/a.gif' }, 'thumb')).toBeNull()
    expect(displayablePhotoUrl({ url: 'data:image/gif;base64,AAAA' }, 'thumb')).toBeNull()
    expect(displayablePhotoUrl({ url: 'http://ucarecdn.com/abc/' }, 'thumb')).toBeNull()
  })
})

const HOST = 'https://ucarecdn.com/11111111-1111-1111-1111-111111111111/'
const rend = (name: string, width: number, height: number, fit: Rendition['fit']): Rendition => ({
  url: `${HOST}${name}.webp`,
  role: name,
  width,
  height,
  fit,
  type: 'image/webp',
})
const original = rend('original', 2048, 1536, 'inside')
const medium = rend('medium', 640, 480, 'inside')
const thumb = rend('thumb', 180, 180, 'cover')

describe('pickRendition', () => {
  it('takes the smallest copy that is big enough, else the largest there is', () => {
    const all = [original, medium, thumb]
    expect(pickRendition(all, 'thumb')).toBe(thumb)
    expect(pickRendition(all, 'card')).toBe(original)
    expect(pickRendition(all, 'full')).toBe(original)
    expect(pickRendition([medium, thumb], 'full')).toBe(medium)
    expect(pickRendition([medium, thumb], 'thumb')).toBe(thumb)
  })
  it('never takes a cover copy for a bigger size', () => {
    expect(pickRendition([thumb], 'full')).toBeNull()
    expect(pickRendition([thumb], 'card')).toBeNull()
  })
  it('never takes a copy from a foreign host', () => {
    const evil = { ...thumb, url: 'https://evil.example/x.webp' }
    expect(pickRendition([evil], 'thumb')).toBeNull()
    expect(pickRendition([evil, medium], 'thumb')).toBe(medium)
  })
  it('gives null for no copies', () => {
    expect(pickRendition(null, 'thumb')).toBeNull()
    expect(pickRendition(undefined, 'thumb')).toBeNull()
    expect(pickRendition([], 'thumb')).toBeNull()
  })
  it('skips malformed elements instead of throwing', () => {
    const bad = [null, 'x', { ...thumb, url: 42 }, { ...thumb, width: 1.5 }, { ...thumb, fit: 'fill' }, thumb] as unknown as Rendition[]
    expect(pickRendition(bad, 'thumb')).toBe(thumb)
    expect(pickRendition([null] as unknown as Rendition[], 'thumb')).toBeNull()
  })
})

describe('displayablePhotoUrl with renditions', () => {
  it('returns the chosen copy, else the address derived from the url', () => {
    const photo = { url: HOST, urls: [original, medium, thumb] }
    expect(displayablePhotoUrl(photo, 'thumb')).toBe(thumb.url)
    expect(displayablePhotoUrl(photo, 'full')).toBe(original.url)
    expect(displayablePhotoUrl({ url: HOST, urls: [thumb] }, 'full')).toBe(photoUrl(HOST, 'full'))
    expect(displayablePhotoUrl({ url: HOST, urls: [null] as unknown as Rendition[] }, 'thumb')).toBe(photoUrl(HOST, 'thumb'))
  })
  it('falls back to the url when the only copy has a foreign host, and refuses a foreign url', () => {
    const evil = { ...thumb, url: 'https://evil.example/x.webp' }
    expect(displayablePhotoUrl({ url: HOST, urls: [evil] }, 'thumb')).toBe(photoUrl(HOST, 'thumb'))
    expect(displayablePhotoUrl({ url: 'https://evil.example/p.jpg', urls: [evil] }, 'thumb')).toBeNull()
    expect(displayablePhotoUrl({ url: 'device:x', urls: [thumb] }, 'thumb')).toBe('device:x')
  })
})

describe('displayablePhotoUrl on ImgBB', () => {
  const rend = (side: number, fit: 'inside' | 'cover', role: string, name: string): Rendition => ({
    role, url: `https://i.ibb.co/c/${name}`, width: side, height: side, type: 'image/webp', fit,
  })
  const ibb = 'https://i.ibb.co/o/photo.webp'
  const copies = [rend(2048, 'inside', 'original', 'o.webp'), rend(640, 'inside', 'medium', 'm.webp'), rend(180, 'cover', 'thumb', 'p.webp')]
  it('marks only the copy chosen for thumb, so the service worker caches it with the thumbnails', () => {
    expect(displayablePhotoUrl({ url: ibb, urls: copies }, 'thumb')).toBe('https://i.ibb.co/c/p.webp?antresol=thumb')
    expect(displayablePhotoUrl({ url: ibb, urls: copies }, 'card')).toBe('https://i.ibb.co/c/o.webp')
    expect(displayablePhotoUrl({ url: ibb, urls: copies }, 'full')).toBe('https://i.ibb.co/c/o.webp')
  })
  it('shows the url of a photo without copies as it is, unmarked', () => {
    expect(displayablePhotoUrl({ url: ibb }, 'thumb')).toBe(ibb)
    expect(displayablePhotoUrl({ url: ibb, urls: [] }, 'thumb')).toBe(ibb)
    expect(displayablePhotoUrl({ url: ibb }, 'full')).toBe(ibb)
  })
  it('puts no marker on a thumb copy of another host', () => {
    const t = { ...rend(160, 'cover', 'thumb', 'x'), url: 'https://ucarecdn.com/abc/-/preview/160x160/' }
    expect(displayablePhotoUrl({ url: 'https://ucarecdn.com/abc/', urls: [t] }, 'thumb')).toBe(t.url)
  })
})

describe('url kinds', () => {
  it('recognises Uploadcare hosts', () => {
    expect(isUploadcareUrl('https://ucarecdn.com/abc/')).toBe(true)
    expect(isUploadcareUrl('https://x1.ucarecd.net/abc/')).toBe(true)
    expect(isUploadcareUrl('http://ucarecdn.com/abc/')).toBe(false)
    expect(isUploadcareUrl('https://evilucarecdn.com/abc/')).toBe(false)
    expect(isUploadcareUrl('not a url')).toBe(false)
  })
  it('recognises device urls', () => {
    expect(isDeviceUrl('device:x')).toBe(true)
    expect(isDeviceUrl('https://ucarecdn.com/abc/')).toBe(false)
  })
})

describe('gallery cover', () => {
  it('is shown at the full size (card stays for places without a cover)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/components/ItemGallery.vue', import.meta.url), 'utf8')
    expect(src).toMatch(/<PhotoImg :photo="cover" size="full"/)
    expect(src).not.toMatch(/size="card"/)
  })
})
