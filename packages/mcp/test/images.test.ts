import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ToolError } from '../src/errors'
import { decodeImage, encodeToJpeg, forModel, forStore } from '../src/images'

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
})
