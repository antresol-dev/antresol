import { describe, expect, it } from 'vitest'
import { createImgbbStore } from '../src/index'
import fixtureDataUri from './fixtures/flat-2048x1536.webp?inline'

// Talks to the real ImgBB; skipped without a key. Each run leaves one image that ImgBB deletes after 10 minutes.
const key = import.meta.env.ANTRESOL_IMGBB_TEST_KEY as string | undefined

describe.skipIf(!key)('ImgBB live upload', () => {
  it('stores every rendition and the delete link', async () => {
    const store = createImgbbStore({ apiKey: key!, expirationSeconds: 600 })
    const stored = await store.upload(await (await fetch(fixtureDataUri)).blob(), 'photo.webp')

    expect(stored.urls).toEqual([
      { url: stored.url, role: 'original', width: 2048, height: 1536, fit: 'inside', type: 'image/webp' },
      expect.objectContaining({ role: 'medium', width: 640, height: 480, fit: 'inside' }),
      expect.objectContaining({ role: 'thumb', width: 180, height: 180, fit: 'cover' }),
    ])
    expect(stored.deleteHandle).toBeTruthy()

    const res = await fetch(stored.url, { headers: { Origin: 'https://antresol-dev.github.io' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})
