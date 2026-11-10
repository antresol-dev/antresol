import { describe, expect, it } from 'vitest'
import { captureBaseline, changedFields } from '../app/lib/changed-fields'

describe('changedFields', () => {
  it('returns only the changed fields', () => {
    expect(changedFields({ name: 'A', description: null }, { name: 'B', description: null })).toEqual({ name: 'B' })
  })

  it('returns nothing when nothing changed', () => {
    expect(changedFields({ name: 'A', description: 'x' }, { name: 'A', description: 'x' })).toEqual({})
  })

  it('ignores surrounding whitespace and treats an empty string as no value', () => {
    expect(changedFields({ name: 'A', description: null }, { name: ' A ', description: '' })).toEqual({})
    expect(changedFields({ name: 'A', description: '' }, { name: 'A', description: null })).toEqual({})
  })

  it('sends a cleared description as null', () => {
    expect(changedFields({ name: 'A', description: 'x' }, { name: 'A', description: null })).toEqual({ description: null })
  })

  it('sends tagIds in full, only when the set changed, whatever the order', () => {
    expect(changedFields({ tagIds: ['a', 'b'] }, { tagIds: ['b', 'a'] })).toEqual({})
    expect(changedFields({ tagIds: ['a', 'b'] }, { tagIds: ['b', 'a', 'c'] })).toEqual({ tagIds: ['b', 'a', 'c'] })
    expect(changedFields({ tagIds: ['a'] }, { tagIds: [] })).toEqual({ tagIds: [] })
  })

  it('compares other values strictly', () => {
    expect(changedFields({ unitKey: 'pcs' }, { unitKey: 'kg' })).toEqual({ unitKey: 'kg' })
  })
})

describe('captureBaseline', () => {
  it('does not move when the source it was taken from changes later', () => {
    // A form opened on "Red"; a refresh swaps in the other device's rename while the input still says "Red".
    const live = { name: 'Red', description: null as string | null, tagIds: ['a'] }
    const baseline = captureBaseline(live)
    live.name = 'Crimson'
    live.tagIds.push('b')
    const typed = { name: 'Red', description: null, tagIds: ['a'] }
    expect(changedFields(baseline, typed)).toEqual({})
    expect(changedFields(live, typed)).toEqual({ name: 'Red', tagIds: ['a'] })
  })
})
