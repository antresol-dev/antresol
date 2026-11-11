import { FileError } from '@graymatter/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fitWithin, isImageType, isOutOfMemory, MAX_SIDE, prepareImage } from '../app/lib/images'

describe('fitWithin', () => {
  it('scales down by the longer side', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: 2048 })
  })
  it('never scales up', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })
  it('keeps both sides at least 1', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 2048, height: 1 })
  })
  it('honours a custom max', () => {
    expect(fitWithin(400, 200, 100)).toEqual({ width: 100, height: 50 })
    expect(MAX_SIDE).toBe(2048)
  })
})

describe('isImageType', () => {
  it('accepts web image types only', () => {
    expect(isImageType('image/jpeg')).toBe(true)
    expect(isImageType('image/png')).toBe(true)
    expect(isImageType('image/webp')).toBe(true)
    expect(isImageType('image/gif')).toBe(true)
    expect(isImageType('image/avif')).toBe(true)
    expect(isImageType('application/pdf')).toBe(false)
    expect(isImageType('video/mp4')).toBe(false)
  })
})

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p
  } catch (e) {
    return e instanceof FileError ? e.code : `other:${String(e)}`
  }
  return undefined
}
const bitmap = () => ({ width: 4000, height: 3000, close: vi.fn() })
const fakeCanvas = (webp: boolean) => {
  const requested: string[] = []
  return {
    requested,
    canvas: {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: () => {}, drawImage: () => {}, fillStyle: '' }),
      toBlob: (cb: (b: Blob) => void, type: string) => {
        requested.push(type)
        cb(new Blob(['x'], { type: type === 'image/webp' && !webp ? 'image/png' : type }))
      },
    },
  }
}

describe('prepareImage errors', () => {
  afterEach(() => vi.unstubAllGlobals())
  const jpeg = (size = 10) => new File([new Uint8Array(size)], 'a.jpg', { type: 'image/jpeg' })

  it('says unsupported for a file the browser cannot understand (HEIC without a decoder)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new DOMException('cannot decode', 'InvalidStateError')))
    expect(await codeOf(prepareImage(new File(['x'], 'a.heic', { type: 'image/heic' })))).toBe('unsupported')
  })
  it('says too_large_to_decode, not unsupported, when memory runs out, also for the reduced retry', async () => {
    const stub = vi.fn().mockRejectedValue(new RangeError('Array buffer allocation failed'))
    vi.stubGlobal('createImageBitmap', stub)
    expect(await codeOf(prepareImage(jpeg()))).toBe('too_large_to_decode')
    expect(stub).toHaveBeenCalledTimes(2)
    expect(stub.mock.calls[1]![1]).toMatchObject({ resizeWidth: MAX_SIDE })
  })
  it('retries a failed full decode at the reduced size and uses that', async () => {
    const stub = vi.fn().mockRejectedValueOnce(new RangeError('out of memory')).mockResolvedValueOnce(bitmap())
    vi.stubGlobal('createImageBitmap', stub)
    vi.stubGlobal('document', { createElement: () => fakeCanvas(false).canvas })
    expect((await prepareImage(jpeg())).type).toBe('image/jpeg')
  })
  it('decodes a big file straight at the reduced size', async () => {
    const stub = vi.fn().mockResolvedValue(bitmap())
    vi.stubGlobal('createImageBitmap', stub)
    vi.stubGlobal('document', { createElement: () => fakeCanvas(false).canvas })
    await prepareImage(jpeg(9 * 1024 * 1024))
    expect(stub).toHaveBeenCalledTimes(1)
    expect(stub.mock.calls[0]![1]).toMatchObject({ resizeWidth: MAX_SIDE })
  })
  it('accepts an upper-case IMAGE/JPEG type', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap()))
    vi.stubGlobal('document', { createElement: () => fakeCanvas(false).canvas })
    const file = new File([new Uint8Array(10)], 'a.jpg', { type: 'IMAGE/JPEG' })
    expect((await prepareImage(file)).type).toBe('image/jpeg')
  })
  it('keeps too_large for a file over the input limit and unsupported for other types', async () => {
    expect(await codeOf(prepareImage(new File(['x'], 'a.pdf', { type: 'application/pdf' })))).toBe('unsupported')
  })
})

describe('isOutOfMemory', () => {
  it('tells memory trouble from an undecodable file', () => {
    expect(isOutOfMemory(new RangeError('x'))).toBe(true)
    expect(isOutOfMemory(new Error('Out of memory'))).toBe(true)
    expect(isOutOfMemory(new DOMException('The source image could not be decoded.', 'InvalidStateError'))).toBe(false)
  })
})
