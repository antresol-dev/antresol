import { describe, expect, it } from 'vitest'
import { createFileStore } from '../src'

const base = { name: 'n', connectionString: 'postgres://u:p@h/db' }

describe('createFileStore', () => {
  it('imgbb with a key', () => {
    expect(createFileStore({ ...base, photoStore: 'imgbb', imgbbApiKey: 'k' })?.provider).toBe('imgbb')
  })
  it('imgbb without a key is none', () => {
    expect(createFileStore({ ...base, photoStore: 'imgbb' })).toBeNull()
  })
  it('defaults to Uploadcare', () => {
    expect(createFileStore({ ...base, uploadcarePublicKey: 'pk' })?.provider).toBe('uploadcare')
  })
  it('no keys is none', () => {
    expect(createFileStore(base)).toBeNull()
  })
})
