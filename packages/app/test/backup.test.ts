import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupFileName, buildBackup, downloadBackup, REVOKE_DELAY_MS } from '../app/lib/backup'

describe('backup file', () => {
  it('holds no connection string or key, even when the source object carries them', () => {
    const source = {
      name: 'Home',
      kind: 'neon',
      connectionString: 'postgres://u:secret@h/db',
      uploadcarePublicKey: 'pk_123',
    }
    const backup = buildBackup({ exportedAt: '2026-11-11T00:00:00Z', app: { schemaVersion: 3 }, source, inventories: [] })
    const text = JSON.stringify(backup)
    for (const forbidden of ['connectionString', 'postgres://', 'uploadcarePublicKey', 'secret', 'pk_123']) {
      expect(text).not.toContain(forbidden)
    }
    expect(backup).toMatchObject({ format: 'graymatter-backup', version: 1, source: { name: 'Home', kind: 'neon' } })
    expect(Object.keys(backup.source)).toEqual(['name', 'kind'])
  })

  it('names the file from a slug of the source name', () => {
    const at = new Date('2026-11-11T10:00:00Z')
    expect(backupFileName('My Garage / #1!', at)).toBe('graymatter-my-garage-1-2026-11-11.json')
    expect(backupFileName('Demo', at)).toBe('graymatter-demo-2026-11-11.json')
    expect(backupFileName('???', at)).toBe('graymatter-source-2026-11-11.json')
  })
})

describe('downloadBackup', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('revokes the object URL only after a delay, so the download can start', () => {
    vi.useFakeTimers()
    const click = vi.fn()
    const link = { href: '', download: '', click, remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => link, body: { append: vi.fn() } })
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: revoke })
    const backup = buildBackup({ exportedAt: 't', app: { schemaVersion: 1 }, source: { name: 'Home', kind: 'neon' }, inventories: [] })
    downloadBackup(backup, new Date('2026-11-11T00:00:00Z'))
    expect(click).toHaveBeenCalled()
    expect(link.download).toBe('graymatter-home-2026-11-11.json')
    expect(revoke).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoke).toHaveBeenCalledWith('blob:x')
  })
})
