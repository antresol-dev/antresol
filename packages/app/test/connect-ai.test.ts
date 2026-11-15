import { decodeConnectionKey, encodeConnectionKey } from '@antresol/kit'
import { describe, expect, it } from 'vitest'
import { connectionSettingsOf } from '../app/lib/connection-share'
import type { SourceConfig } from '../app/lib/types'

const CONFIG: SourceConfig = {
  id: 'src-1',
  kind: 'neon',
  name: 'Workshop',
  connectionString: 'postgresql://user:pw@ep-x.eu-central-1.aws.neon.tech/db?sslmode=require',
  photoStore: 'imgbb',
  uploadcarePublicKey: null,
  imgbbApiKey: 'imgbb-key-123',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('Connect AI', () => {
  it('the connection key holds the connection string and the ImgBB key, not id and createdAt', () => {
    const text = encodeConnectionKey(connectionSettingsOf(CONFIG))
    const back = decodeConnectionKey(text)
    expect(back.connectionString).toBe(CONFIG.connectionString)
    expect(back.imgbbApiKey).toBe('imgbb-key-123')
    expect(back.photoStore).toBe('imgbb')
    expect(back.name).toBe('Workshop')
    expect(back).not.toHaveProperty('id')
    expect(back).not.toHaveProperty('createdAt')
    expect(connectionSettingsOf(CONFIG)).not.toHaveProperty('id')
  })
})
