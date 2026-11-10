import { describe, expect, it } from 'vitest'
import { parseNameList } from '../app/lib/lists'

describe('parseNameList', () => {
  it('splits on commas, semicolons and line breaks, trims, drops empties and case-insensitive duplicates', () => {
    expect(parseNameList('1k, 10k\n100k;  ,1K')).toEqual(['1k', '10k', '100k'])
  })
  it('handles Windows line breaks and an empty text', () => {
    expect(parseNameList('a\r\nb')).toEqual(['a', 'b'])
    expect(parseNameList('  \n ; ')).toEqual([])
  })
})
