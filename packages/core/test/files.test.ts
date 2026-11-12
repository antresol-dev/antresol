import { describe, expect, it } from 'vitest'
import { FILE_ERROR_CODES, FileError } from '../src'

describe('FileError', () => {
  it('keeps its code and name', () => {
    const e = new FileError('too_large')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('FileError')
    expect(e.code).toBe('too_large')
    expect(e.message).toBe('too_large')
  })
  it('takes a custom message', () => {
    expect(new FileError('failed', 'boom').message).toBe('boom')
  })
  it('lists every code', () => {
    expect(FILE_ERROR_CODES).toEqual(['no_store', 'unsupported', 'too_large', 'too_large_to_decode', 'rejected', 'unavailable', 'failed'])
  })
})
