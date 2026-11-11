import { afterEach, describe, expect, it, vi } from 'vitest'

// supportsWebp is decided once per page; each test needs its own answer, so the module is loaded fresh.
const load = async (webp: boolean) => {
  vi.resetModules()
  const requested: string[] = []
  const canvas = {
    width: 0,
    height: 0,
    toBlob: (cb: (b: Blob) => void, type: string) => {
      requested.push(type)
      cb(new Blob(['x'], { type: type === 'image/webp' && !webp ? 'image/png' : type }))
    },
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  const mod = await import('../app/lib/images')
  return { ...mod, canvas: canvas as unknown as HTMLCanvasElement, requested }
}

describe('upload encoding', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('encodes WebP where the browser can', async () => {
    const { encodeCanvas, canvas } = await load(true)
    expect((await encodeCanvas(canvas))?.type).toBe('image/webp')
  })
  it('falls back to JPEG where toBlob answers a PNG for WebP', async () => {
    const { encodeCanvas, canvas, requested } = await load(false)
    expect((await encodeCanvas(canvas))?.type).toBe('image/jpeg')
    expect(requested).toContain('image/jpeg')
  })
})
