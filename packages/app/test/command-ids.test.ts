import { describe, expect, it } from 'vitest'
import { useCommandIds } from '../app/composables/useCommandIds'

describe('useCommandIds', () => {
  it('gives every key its own id, stable until renewed', () => {
    const { ids, renew } = useCommandIds(['a', 'b'] as const)
    expect(ids.a).toBeTruthy()
    expect(ids.a).not.toBe(ids.b)
    const before = { ...ids }
    expect({ ...ids }).toEqual(before)
    renew()
    expect(ids.a).not.toBe(before.a)
    expect(ids.b).not.toBe(before.b)
  })

  it('two forms do not share ids', () => {
    expect(useCommandIds(['a'] as const).ids.a).not.toBe(useCommandIds(['a'] as const).ids.a)
  })
})
