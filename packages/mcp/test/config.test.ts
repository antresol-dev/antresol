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
