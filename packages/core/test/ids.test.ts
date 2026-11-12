import { describe, expect, it } from 'vitest'
import { newId } from '../src/ids'

describe('ids', () => {
  it('generates uuid v7', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
  it('is monotonic', () => {
    const a = newId(), b = newId()
    expect(a < b).toBe(true)
  })
})
