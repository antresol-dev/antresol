import { describe, expect, it } from 'vitest'
import { fitWithin, isImageType, MAX_SIDE } from '../app/lib/images'

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
