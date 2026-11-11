import { describe, expect, it } from 'vitest'
import { displayablePhotoUrl, isDeviceUrl, isUploadcareUrl, photoUrl } from '../app/lib/photo-url'

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
    expect(displayablePhotoUrl('https://i.imgur.com/Ab1.jpg', 'thumb')).toBe('https://i.imgur.com/Ab1m.jpg')
    expect(displayablePhotoUrl('https://res.cloudinary.com/d/image/upload/a.jpg', 'thumb')).toContain('w_400')
    expect(displayablePhotoUrl('https://res.cloudinary.com.evil.com/d/image/upload/a.jpg', 'thumb')).toBeNull()
  })
})

describe('displayablePhotoUrl', () => {
  it('allows Uploadcare and device urls only', () => {
    expect(displayablePhotoUrl('https://ucarecdn.com/abc/', 'card')).toContain('/-/preview/800x800/')
    expect(displayablePhotoUrl('device:x', 'thumb')).toBe('device:x')
    expect(displayablePhotoUrl('https://example.com/a.gif', 'thumb')).toBeNull()
    expect(displayablePhotoUrl('data:image/gif;base64,AAAA', 'thumb')).toBeNull()
    expect(displayablePhotoUrl('http://ucarecdn.com/abc/', 'thumb')).toBeNull()
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
