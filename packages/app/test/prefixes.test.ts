import { BUILTIN_UNITS } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { prefixList, prefixNote } from '../app/lib/prefixes'

describe('prefixNote', () => {
  it('labels a prefix with its symbol, name and power', () => {
    expect(prefixNote(24)).toBe('Y · yotta (10^24)')
    expect(prefixNote(-6)).toBe('µ · micro (10^-6)')
  })
})

describe('prefixList', () => {
  it('lists the unit with each prefix in ascending power; pieces take a bare prefix', () => {
    expect(prefixList(BUILTIN_UNITS.m)).toBe('mm, cm, km')
    expect(prefixList(BUILTIN_UNITS.pcs)).toBe('k, M')
  })
})
