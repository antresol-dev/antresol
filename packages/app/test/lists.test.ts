import { describe, expect, it } from 'vitest'
import { parseNameList, splitValueList, splitVariantLines } from '../app/lib/lists'

describe('parseNameList', () => {
  it('splits on commas, semicolons and line breaks, trims, drops empties and case-insensitive duplicates', () => {
    expect(parseNameList('1k, 10k\n100k;  ,1K')).toEqual(['1k', '10k', '100k'])
  })
  it('handles Windows line breaks and an empty text', () => {
    expect(parseNameList('a\r\nb')).toEqual(['a', 'b'])
    expect(parseNameList('  \n ; ')).toEqual([])
  })
})

describe('splitValueList', () => {
  it('reads a comma between two digits of a number as a decimal comma', () => {
    expect(splitValueList('1k, 4,7k;10k\r\n', 'number')).toEqual(['1k', '4,7k', '10k'])
  })
  it('splits text on every comma, keeps repeats and drops empty parts', () => {
    expect(splitValueList('a,b', 'text')).toEqual(['a', 'b'])
    expect(splitValueList('1,2;;a, a', 'enum')).toEqual(['1', '2', 'a', 'a'])
  })
})

describe('splitVariantLines', () => {
  it('gives the values of each line in axis order, dropping empty lines and trailing empty parts', () => {
    expect(splitVariantLines('100n; 50V;\r\n\r\n10u;16V')).toEqual([['100n', '50V'], ['10u', '16V']])
  })
  it('keeps an empty part in the middle', () => {
    expect(splitVariantLines('100n;;5')).toEqual([['100n', '', '5']])
  })
})
