import { describe, expect, it } from 'vitest'
import { memoryKeyValue } from '../app/lib/diagnostics'
import { createUploadCounter } from '../app/lib/uploads'

describe('upload counter', () => {
  it('counts per source and starts again in a new month', async () => {
    let now = new Date('2026-11-30T12:00:00Z')
    const c = createUploadCounter({ kv: memoryKeyValue(), now: () => now })
    c.count('a')
    c.count('a')
    c.count('b')
    expect(await c.thisMonth('a')).toBe(2)
    expect(await c.thisMonth('b')).toBe(1)
    now = new Date('2026-12-01T00:00:00Z')
    expect(await c.thisMonth('a')).toBe(0)
    c.count('a')
    expect(await c.thisMonth('a')).toBe(1)
  })
})
