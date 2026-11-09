import { describe, expect, it } from 'vitest'
import { addQ, cmpQ, isPositiveQ, parseQuantity, subQ } from '../src/quantity'

describe('quantity', () => {
  it('adds and subtracts exactly', () => {
    expect(addQ('0.1', '0.2')).toBe('0.3')
    expect(subQ('96', '59')).toBe('37')
  })
  it('parses', () => {
    expect(parseQuantity(' 1,5 ')).toBe('1.5')
    expect(parseQuantity('007')).toBe('7')
    expect(parseQuantity('2.500')).toBe('2.5')
    expect(parseQuantity('1.2345678')).toBeNull()
    expect(parseQuantity('')).toBeNull()
    expect(parseQuantity('abc')).toBeNull()
  })
  it('compares', () => {
    expect(cmpQ('10', '9')).toBe(1)
    expect(isPositiveQ('0')).toBe(false)
  })
})
