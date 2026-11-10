import { describe, expect, it } from 'vitest'
import { isDeviceUrl, isUploadcareUrl, photoUrl } from '../app/lib/photo-url'

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
