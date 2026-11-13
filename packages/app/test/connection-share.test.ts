import { describe, expect, it } from 'vitest'
import { connectionLink, encodeConnection, readConnection } from '../app/lib/connection-share'
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

describe('connection share', () => {
  it('round-trips through the QR address, without id, time and empty settings', () => {
    const link = connectionLink('https://antresol-dev.github.io/antresol/', SOURCE)
    expect(link).toMatch(/^https:\/\/antresol-dev\.github\.io\/antresol\/settings\/sources\/new#connect=[\w-]+$/)
    expect(readConnection(link)).toEqual({
      name: 'Мастерская',
      connectionString: SOURCE.connectionString,
      photoStore: 'imgbb',
      imgbbApiKey: 'abc123',
    })
  })

  it('reads a bare fragment as the page gets it', () => {
    expect(readConnection(`#connect=${encodeConnection(SOURCE)}`)?.name).toBe('Мастерская')
  })

  it('adds the slash a base without one is missing', () => {
    expect(connectionLink('http://localhost:3000', SOURCE)).toMatch(/^http:\/\/localhost:3000\/settings\/sources\/new#/)
  })

  it('refuses other codes, broken data and connection strings the form would refuse', () => {
    expect(readConnection('https://example.com/')).toBeNull()
    expect(readConnection('#connect=!!!')).toBeNull()
    expect(readConnection('#connect=bm90IGpzb24')).toBeNull()
    expect(readConnection(`#connect=${encodeConnection({ ...SOURCE, connectionString: 'https://x' })}`)).toBeNull()
  })

  it('drops an unknown photo store', () => {
    const bad = btoa(JSON.stringify({ v: 1, name: 'A', connectionString: SOURCE.connectionString, photoStore: 'flickr' }))
    expect(readConnection(`#connect=${bad.replace(/=+$/, '')}`)).toEqual({ name: 'A', connectionString: SOURCE.connectionString })
  })
})
