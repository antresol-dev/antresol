import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ToolError } from '../src/errors'
import { applyOrientation, decodeImage, encodeToJpeg, exifOrientation, forModel, forStore } from '../src/images'

const fixture = (name: string) => readFile(path.join(__dirname, 'fixtures', name))

/** A colour picture with noise, so that the JPEG is not tiny. */
async function bigJpeg(width: number, height: number): Promise<Uint8Array> {
  const data = new Uint8ClampedArray(width * height * 4)
  let seed = 7
  for (let i = 0; i < width * height; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const x = i % width
    const y = Math.floor(i / width)
    data[i * 4] = (x >> 4) + (seed & 31)
    data[i * 4 + 1] = (y >> 4) + ((seed >> 5) & 31)
    data[i * 4 + 2] = ((x + y) >> 5) + ((seed >> 10) & 31)
    data[i * 4 + 3] = 255
  }
  return encodeToJpeg({ width, height, data }, 90)
}

const longSide = (p: { width: number; height: number }) => Math.max(p.width, p.height)

describe('images', () => {
  it('forStore scales a 6000x4000 JPEG to 2048 on the long side and encodes WebP with a neutral name', async () => {
    const jpeg = await bigJpeg(6000, 4000)
    const out = await forStore(jpeg, 'IMG_2026-11-15_home.jpg')
    expect(out.blob.type).toBe('image/webp')
    expect(out.name).toBe('photo.webp')
    expect(out.width).toBe(2048)
    expect(out.height).toBe(1365)
    const back = await decodeImage(new Uint8Array(await out.blob.arrayBuffer()), 'x.webp')
    expect([back.width, back.height]).toEqual([2048, 1365])
  }, 60000)

  it('forModel scales to at most 1568 and keeps the base64 within 1 MB', async () => {
    const out = await forModel(await bigJpeg(6000, 4000), 'big.jpg')
    expect(out.mimeType).toBe('image/jpeg')
    expect(out.data.length).toBeLessThanOrEqual(1_048_576)
    const back = await decodeImage(Buffer.from(out.data, 'base64'), 'shown.jpg')
    expect(longSide(back)).toBeLessThanOrEqual(1568)
    expect(longSide(back)).toBeGreaterThan(1500)
  }, 60000)

  it('never scales a small picture up and reads PNG', async () => {
    const out = await forStore(await fixture('gradient.png'), 'gradient.png')
    expect([out.width, out.height]).toEqual([64, 48])
  })

  it('decodes HEIC', async () => {
    const heic = await decodeImage(await fixture('gradient.heic'), 'gradient.heic')
    expect([heic.width, heic.height]).toEqual([64, 48])
    const png = await decodeImage(await fixture('gradient.png'), 'gradient.png')
    const red = (p: typeof png, x: number, y: number) => p.data[(y * p.width + x) * 4]!
    expect(red(heic, 60, 5)).toBeGreaterThan(red(heic, 3, 5) + 100)
    expect(Math.abs(red(heic, 40, 20) - red(png, 40, 20))).toBeLessThan(40)
  })

  it('refuses a text file named .jpg, by name', async () => {
    const error = await decodeImage(new TextEncoder().encode('just text'), 'notes.jpg').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as Error).message).toBe('not an image this server can read: notes.jpg')
  })

  describe('EXIF orientation', () => {
    /** 32x16: the top-left 16x8 block is red, the rest blue. */
    async function corner(): Promise<Uint8Array> {
      const w = 32
      const h = 16
      const data = new Uint8ClampedArray(w * h * 4)
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const red = x < 16 && y < 8
          data.set([red ? 255 : 0, 0, red ? 0 : 255, 255], (y * w + x) * 4)
        }
      return encodeToJpeg({ width: w, height: h, data }, 95)
    }
    /** The bytes with an APP1/Exif segment holding only Orientation, in the given byte order. */
    function withOrientation(jpeg: Uint8Array, value: number, little: boolean): Uint8Array {
      const u16 = (n: number) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
      const u32 = (n: number) => (little ? [n & 255, (n >> 8) & 255, 0, 0] : [0, 0, (n >> 8) & 255, n & 255])
      const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(value), 0, 0, ...u32(0)]
      const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
      const segment = [0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body]
      return Uint8Array.from([0xff, 0xd8, ...segment, ...jpeg.subarray(2)])
    }
    const isRed = (p: { width: number; data: Uint8ClampedArray }, x: number, y: number) => p.data[(y * p.width + x) * 4]! > 200

    it('reads the tag in both byte orders and 1 when there is none', async () => {
      const jpeg = await corner()
      expect(exifOrientation(jpeg)).toBe(1)
      expect(exifOrientation(withOrientation(jpeg, 6, true))).toBe(6)
      expect(exifOrientation(withOrientation(jpeg, 8, false))).toBe(8)
    })

    it('orientation 6 turns the picture 90 degrees clockwise: size swapped, top-left goes to top-right', async () => {
      const p = await decodeImage(withOrientation(await corner(), 6, false), 'phone.jpg')
      expect([p.width, p.height]).toEqual([16, 32])
      expect(isRed(p, 13, 3)).toBe(true)
      expect(isRed(p, 2, 3)).toBe(false)
      expect(isRed(p, 13, 28)).toBe(false)
    })

    it('orientation 8 and 3 and 2 put the red block in the right corner', async () => {
      const jpeg = await corner()
      const ccw = await decodeImage(withOrientation(jpeg, 8, true), 'a.jpg')
      expect([ccw.width, ccw.height]).toEqual([16, 32])
      expect(isRed(ccw, 2, 28)).toBe(true)
      const half = await decodeImage(withOrientation(jpeg, 3, true), 'b.jpg')
      expect(isRed(half, 29, 13)).toBe(true)
      const mirror = await decodeImage(withOrientation(jpeg, 2, true), 'c.jpg')
      expect(isRed(mirror, 29, 3)).toBe(true)
    })

    it('every orientation 2-8 moves the top-left pixel of a 2x1 picture where the EXIF table says', () => {
      const p = { width: 2, height: 1, data: Uint8ClampedArray.from([255, 0, 0, 255, 0, 0, 255, 255]) }
      const redAt = (o: number) => {
        const r = applyOrientation(p, o)
        const i = [...Array(r.width * r.height).keys()].find((k) => r.data[k * 4] === 255)!
        return [i % r.width, Math.floor(i / r.width), r.width, r.height]
      }
      expect(redAt(2)).toEqual([1, 0, 2, 1])
      expect(redAt(3)).toEqual([1, 0, 2, 1])
      expect(redAt(4)).toEqual([0, 0, 2, 1])
      expect(redAt(5)).toEqual([0, 0, 1, 2])
      expect(redAt(6)).toEqual([0, 0, 1, 2])
      expect(redAt(7)).toEqual([0, 1, 1, 2])
      expect(redAt(8)).toEqual([0, 1, 1, 2])
    })
  })
})
