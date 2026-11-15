import { describe, expect, it } from 'vitest'
import { CONNECTION_KEY_PREFIX, decodeConnectionKey, encodeConnectionKey, type ConnectionSettings } from '../src'

const CS = 'postgres://user:s3cretpw@host.example/db'
const full: ConnectionSettings = { name: 'Home', connectionString: CS, photoStore: 'imgbb', imgbbApiKey: 'key123' }
const bare: ConnectionSettings = { name: 'Home', connectionString: CS }
const enc = (o: unknown): string => encodeConnectionKey(o as ConnectionSettings).slice(CONNECTION_KEY_PREFIX.length)
const b64 = (o: unknown): string => CONNECTION_KEY_PREFIX + btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function messageOf(text: string): string {
  try {
    decodeConnectionKey(text)
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('did not throw')
}

describe('connection key', () => {
  it('round-trips', () => {
    expect(decodeConnectionKey(encodeConnectionKey(full))).toEqual(full)
    expect(decodeConnectionKey(encodeConnectionKey(bare))).toEqual(bare)
  })
  it('allows whitespace around the key', () => {
    expect(decodeConnectionKey(`  \n${encodeConnectionKey(full)}\n `)).toEqual(full)
  })
  it('refuses bad keys without leaking content', () => {
    const body = enc(bare)
    const bad = [
      'other-prefix:' + body,
      CONNECTION_KEY_PREFIX + '!!!not base64!!!' + CS,
      b64({ name: 'x' }),
      b64({ name: 'x', connectionString: 'mysql://u:s3cretpw@h/db' }),
      b64({ ...full, photoStore: 'dropbox' }),
    ]
    for (const text of bad) {
      const m = messageOf(text)
      expect(m).not.toContain('s3cretpw')
      expect(m).not.toContain(CS)
      expect(m).not.toContain(body)
      expect(m).not.toContain('key123')
    }
  })
})
