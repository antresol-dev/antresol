import { describe, expect, it } from 'vitest'
import {
  connectionLink,
  endPairing,
  formatPairingCode,
  newPairingCode,
  normalizePairingCode,
  openConnection,
  PAIRING_TTL_MS,
  pairToken,
  pendingPairing,
  sealConnection,
  startPairing,
} from '../app/lib/connection-share'
import type { SourceConfig } from '../app/lib/types'

const SOURCE: SourceConfig = {
  id: 'src-1',
  kind: 'neon',
  name: 'Мастерская',
  connectionString: 'postgresql://user:p%40ss@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require',
  photoStore: 'imgbb',
  uploadcarePublicKey: null,
  uploadcareCdnBase: '',
  imgbbApiKey: 'abc123',
  createdAt: '2026-11-13T00:00:00Z',
}
const CODE = 'K7M2Q9XP'

function memory(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as Storage
}

describe('pairing codes', () => {
  it('makes 8-character codes that survive their own normalization', () => {
    const code = newPairingCode()
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(normalizePairingCode(formatPairingCode(code))).toBe(code)
  })

  it('reads what a person types: case, spaces, dashes, O for 0, I and L for 1', () => {
    expect(normalizePairingCode(' k7m2-q9xp ')).toBe(CODE)
    expect(normalizePairingCode('O1IL 2345')).toBe('01112345')
    expect(normalizePairingCode('K7M2Q9X')).toBeNull()
    expect(normalizePairingCode('K7M2Q9XU')).toBeNull()
  })

  it('waits with a code until it expires or is ended', () => {
    const storage = memory()
    expect(pendingPairing(storage, 0)).toBeNull()
    const p = startPairing(storage, 1000)
    expect(pendingPairing(storage, 1000 + PAIRING_TTL_MS - 1)).toEqual(p)
    expect(pendingPairing(storage, 1000 + PAIRING_TTL_MS)).toBeNull()
    endPairing(storage)
    expect(pendingPairing(storage, 1000)).toBeNull()
  })

  it('has no waiting code without storage, or when storage throws', () => {
    expect(pendingPairing(null, 0)).toBeNull()
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} } as unknown as Storage
    expect(startPairing(broken, 0).code).toHaveLength(8)
    expect(pendingPairing(broken, 0)).toBeNull()
  })
})

describe('sealed connections', () => {
  it('round-trip through the QR link with the right code, without id, time and empty settings', async () => {
    const link = await connectionLink('https://antresol-dev.github.io/antresol/', SOURCE, CODE)
    expect(link).toMatch(/^https:\/\/antresol-dev\.github\.io\/antresol\/settings\/sources\/new#pair=[\w-]+$/)
    expect(link).not.toContain('neon.tech')
    expect(await openConnection(pairToken(link)!, CODE)).toEqual({
      name: 'Мастерская',
      connectionString: SOURCE.connectionString,
      photoStore: 'imgbb',
      imgbbApiKey: 'abc123',
    })
  })

  it('refuse another code and a changed token', async () => {
    const token = await sealConnection(SOURCE, CODE)
    expect(await openConnection(token, 'K7M2Q9XQ')).toBeNull()
    const flipped = token.slice(0, -2) + (token.at(-2) === 'A' ? 'B' : 'A') + token.at(-1)
    expect(await openConnection(flipped, CODE)).toBeNull()
    expect(await openConnection('!!!', CODE)).toBeNull()
    expect(await openConnection('AQ', CODE)).toBeNull()
  })

  it('refuse a connection string the form would refuse, even under the right code', async () => {
    const token = await sealConnection({ ...SOURCE, connectionString: 'https://x' }, CODE)
    expect(await openConnection(token, CODE)).toBeNull()
  })

  it('find the token in a link, a fragment or nothing', () => {
    expect(pairToken('#pair=abc_-1')).toBe('abc_-1')
    expect(pairToken('https://h/settings/sources/new#pair=xyz')).toBe('xyz')
    expect(pairToken('https://example.com/#connect=xyz')).toBeNull()
  })
})
