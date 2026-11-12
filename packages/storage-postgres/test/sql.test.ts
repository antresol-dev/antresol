import { describe, expect, it } from 'vitest'
import { sql, updateSet } from '../src/sql'

describe('sql', () => {
  it('numbers interpolated values', () => {
    expect(sql`select ${1}, ${'a'}`).toEqual({ text: 'select $1, $2', params: [1, 'a'] })
  })
  it('inlines nested statements with renumbered params', () => {
    expect(sql`a ${sql`b ${1}`} c ${2}`).toEqual({ text: 'a b $1 c $2', params: [1, 2] })
  })
})

describe('updateSet', () => {
  it('quotes columns and skips undefined', () => {
    expect(updateSet({ name: 'x', description: undefined, note: null })).toEqual({
      text: '"name" = $1, "note" = $2',
      params: ['x', null],
    })
  })
})
