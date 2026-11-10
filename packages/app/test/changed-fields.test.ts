import { describe, expect, it } from 'vitest'
import { changedFields } from '../app/lib/changed-fields'

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
