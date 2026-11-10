import { describe, expect, it } from 'vitest'
import { CURRENCIES } from '@graymatter/core'
import { currencyOptions } from '../app/lib/currencies'

describe('currencyOptions', () => {
  it('puts the code match first', () => {
    expect(currencyOptions('eur')[0]?.code).toBe('EUR')
  })

  it('finds by name', () => {
    expect(currencyOptions('yen').map((c) => c.code)).toContain('JPY')
  })

  it('ranks exact code, then code prefix, then name substring', () => {
    const codes = currencyOptions('us').map((c) => c.code)
    const prefixEnd = codes.findIndex((c) => !c.startsWith('US'))
    expect(prefixEnd).toBeGreaterThan(0)
    expect(codes.slice(0, prefixEnd).every((c) => c.startsWith('US'))).toBe(true)
    const rest = currencyOptions('us').slice(prefixEnd)
    expect(rest.some((c) => c.code.startsWith('US'))).toBe(false)
    expect(rest.every((c) => c.name.toLowerCase().includes('us'))).toBe(true)
    expect(currencyOptions('usd')[0]?.code).toBe('USD')
  })

  it('returns all currencies by code for an empty query', () => {
    const all = currencyOptions('')
    expect(all.length).toBe(Object.keys(CURRENCIES).length)
    expect(all[0]?.code).toBe('AED')
    const codes = all.map((c) => c.code)
    expect(codes).toEqual([...codes].sort())
  })

  it('returns nothing when nothing matches', () => {
    expect(currencyOptions('zzzzqq')).toEqual([])
  })
})
