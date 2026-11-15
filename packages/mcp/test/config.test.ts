import path from 'node:path'
import { encodeConnectionKey } from '@antresol/kit'
import { describe, expect, it } from 'vitest'
import { defaultPhotosDir, readConfig } from '../src/config'

describe('readConfig', () => {
  it('reports a missing key', () => {
    const c = readConfig({}, 'darwin', '/Users/a')
    expect(c.connection).toBeNull()
    expect(c.connectionProblem).toBe('missing')
    expect(readConfig({ ANTRESOL_CONNECTION: '  ' }, 'darwin', '/Users/a').connectionProblem).toBe('missing')
  })

  it('reports a key that does not decode', () => {
    const c = readConfig({ ANTRESOL_CONNECTION: 'garbage' }, 'darwin', '/Users/a')
    expect(c.connection).toBeNull()
    expect(c.connectionProblem).toBe('invalid')
  })

  it('decodes a good key', () => {
    const key = encodeConnectionKey({ name: 'Home', connectionString: 'postgresql://u:p@h/db' })
    const c = readConfig({ ANTRESOL_CONNECTION: key }, 'linux', '/home/a')
    expect(c.connectionProblem).toBeNull()
    expect(c.connection?.connectionString).toBe('postgresql://u:p@h/db')
  })

  it('keeps its state in ~/.antresol', () => {
    expect(readConfig({}, 'linux', '/home/a').stateDir).toBe(path.join('/home/a', '.antresol'))
  })

  it('takes the photos folder from ANTRESOL_PHOTOS_DIR', () => {
    expect(readConfig({ ANTRESOL_PHOTOS_DIR: '/mnt/photos' }, 'linux', '/home/a').photosDir).toBe('/mnt/photos')
  })

  it('treats an empty ANTRESOL_PHOTOS_DIR as unset', () => {
    expect(readConfig({ ANTRESOL_PHOTOS_DIR: '' }, 'linux', '/home/a').photosDir).toBe('/home/a/Pictures/Antresol')
    expect(readConfig({ ANTRESOL_PHOTOS_DIR: '   ' }, 'darwin', '/Users/a').photosDir).toBe(path.join('/Users/a', 'Pictures', 'Antresol'))
  })
})

describe('defaultPhotosDir', () => {
  it('macOS', () => {
    expect(defaultPhotosDir('darwin', {}, '/Users/a')).toBe(path.join('/Users/a', 'Pictures', 'Antresol'))
  })
  it('Windows', () => {
    expect(defaultPhotosDir('win32', {}, 'C:\\Users\\a')).toBe(path.win32.join('C:\\Users\\a', 'Pictures', 'Antresol'))
  })
  it('Linux with XDG_PICTURES_DIR', () => {
    expect(defaultPhotosDir('linux', { XDG_PICTURES_DIR: '/data/pics' }, '/home/a')).toBe('/data/pics/Antresol')
  })
  it('Linux without it', () => {
    expect(defaultPhotosDir('linux', {}, '/home/a')).toBe('/home/a/Pictures/Antresol')
  })
})

describe('unexpanded host placeholders', () => {
  it('treats ${user_config.photos_dir} as an unset photos folder', () => {
    expect(readConfig({ ANTRESOL_PHOTOS_DIR: '${user_config.photos_dir}' }, 'linux', '/home/a').photosDir).toBe('/home/a/Pictures/Antresol')
  })
  it('treats ${user_config.connection_key} as a missing key', () => {
    const c = readConfig({ ANTRESOL_CONNECTION: '${user_config.connection_key}' }, 'linux', '/home/a')
    expect(c.connectionProblem).toBe('missing')
    expect(c.connectionKey).toBeNull()
  })
  it('the manifest gives photos_dir an empty default', async () => {
    const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(__dirname, '../mcpb/manifest.json'), 'utf8'))
    expect(manifest.user_config.photos_dir.default).toBe('')
  })
})

describe('secretsOf', () => {
  it('holds the raw key text and trimmed secrets', async () => {
    const { secretsOf } = await import('../src/errors')
    const key = encodeConnectionKey({ name: 'Home', connectionString: 'postgresql://u:hunter2@h/db', imgbbApiKey: '  abcd1234  ' })
    const secrets = secretsOf(readConfig({ ANTRESOL_CONNECTION: ` ${key} ` }, 'linux', '/home/a'))
    expect(secrets).toContain(key)
    expect(secrets).toContain('abcd1234')
    expect(secrets).toContain('hunter2')
  })
  it('hides a key that does not decode', async () => {
    const { secretsOf } = await import('../src/errors')
    expect(secretsOf(readConfig({ ANTRESOL_CONNECTION: 'garbage-key-text' }, 'linux', '/home/a'))).toEqual(['garbage-key-text'])
  })
})
