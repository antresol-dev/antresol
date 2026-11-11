import { describe, expect, it } from 'vitest'
import { createDiagnostics, formatErrors, MAX_ENTRIES, memoryKeyValue, scrub, secretsOf } from '../app/lib/diagnostics'

const make = (secrets: string[] = []) => createDiagnostics({ kv: memoryKeyValue(), secrets: () => secrets })

describe('error log', () => {
  it('keeps no connection string and no key from the settings', async () => {
    const config = {
      connectionString: 'postgresql://user:pw-s3cret@ep-x.neon.tech/db',
      uploadcarePublicKey: 'demopublickey123',
      someApiToken: 'tok-abcdef',
    }
    const log = make(secretsOf(config))
    log.logError(
      'connect postgresql://user:pw-s3cret@ep-x.neon.tech/db',
      new Error('failed for postgres://user:pw-s3cret@ep-x.neon.tech/db with key demopublickey123, pw-s3cret and tok-abcdef'),
    )
    const [entry] = await log.readErrors()
    const dump = JSON.stringify(entry) + formatErrors([entry!])
    for (const secret of ['pw-s3cret', 'demopublickey123', 'tok-abcdef', 'ep-x.neon.tech']) expect(dump).not.toContain(secret)
    expect(entry!.message).toContain('failed for')
  })

  it('scrubs the URL-encoded form of a password', () => {
    expect(scrub('bad p%40ss here', ['p@ss'])).not.toContain('p%40ss')
  })

  it('records time, place, code and text, newest first, and keeps the last 200', async () => {
    const log = createDiagnostics({ kv: memoryKeyValue(), now: () => new Date('2026-11-11T10:00:00Z') })
    log.logError('write', Object.assign(new Error('boom'), { code: 'unavailable' }))
    for (let i = 0; i < MAX_ENTRIES + 5; i++) log.logError('load', new Error(`e${i}`))
    const entries = await log.readErrors()
    expect(entries).toHaveLength(MAX_ENTRIES)
    expect(entries[0]).toEqual({ at: '2026-11-11T10:00:00.000Z', where: 'load', code: 'Error', message: `e${MAX_ENTRIES + 4}` })
    expect(entries.at(-1)!.message).toBe('e5')
  })

  it('shows the driver words behind a generic unreachable error', async () => {
    const log = make()
    log.logError('storage', Object.assign(new Error('database unreachable'), { cause: new TypeError('Failed to fetch') }))
    expect((await log.readErrors())[0]!.message).toBe('database unreachable (TypeError: Failed to fetch)')
  })
})
