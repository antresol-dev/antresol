import { PGlite } from '@electric-sql/pglite'
import { StorageError } from '@antresol/core'
import { createPgliteExecutor, inspectSchema, type PgExecutor } from '@antresol/storage-postgres'
import { describe, expect, it } from 'vitest'
import { canSaveSource, checkConnectionString, classifyFailure, createNeonDriver, photoStoreProblem, redactSecret } from '../app/lib/sources'
import type { SourceConfig } from '../app/lib/types'

const cfg = (connectionString = 'postgresql://u:secret@h/db'): SourceConfig => ({
  id: 's1',
  kind: 'neon',
  name: 'S',
  connectionString,
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
})

describe('checkConnectionString', () => {
  it.each([
    ['', 'empty'],
    ['https://x', 'not_postgres_url'],
    ['postgresql://u@h/db', 'missing_password'],
    ['postgresql://u:p@h', 'missing_database'],
    ['postgresql://u:p@h/db?sslmode=require', null],
  ])('%j -> %j', (input, expected) => {
    expect(checkConnectionString(input)).toBe(expected)
  })
})

describe('createNeonDriver', () => {
  it('probes without writing, then connects and creates the schema', async () => {
    const db = new PGlite()
    const exec = createPgliteExecutor(db)
    const keepOpen = { ...exec, close: async () => {} }
    const driver = createNeonDriver(() => keepOpen)
    expect(await driver.probe(cfg())).toEqual({ ok: true, inspection: { state: 'empty' } })
    expect(await inspectSchema(exec)).toEqual({ state: 'empty' })
    const conn = await driver.connect(cfg())
    expect(conn.status.state).toBe('ready')
    expect(await driver.probe(cfg())).toMatchObject({ ok: true, inspection: { state: 'current' } })
    await conn.close()
    await exec.close()
  })

  it('rejects a foreign database as incompatible', async () => {
    const db = new PGlite()
    await db.exec('create table accounts (id int)')
    const driver = createNeonDriver(() => createPgliteExecutor(db))
    await expect(driver.connect(cfg())).rejects.toMatchObject({ code: 'incompatible' })
  })

  it('rejects a pre-release database as outdated, classified as outdated', async () => {
    const db = new PGlite()
    await db.exec("create table antresol_meta (key text primary key, value text not null); insert into antresol_meta values ('schema_version', '2')")
    const driver = createNeonDriver(() => createPgliteExecutor(db))
    const err = await driver.connect(cfg()).catch((e) => e)
    expect(err).toMatchObject({ code: 'outdated' })
    expect(classifyFailure(err)).toBe('outdated')
  })

  it('probes a pre-release database as outdated, which cannot be saved', async () => {
    const db = new PGlite()
    await db.exec("create table antresol_meta (key text primary key, value text not null); insert into antresol_meta values ('schema_version', '2')")
    const driver = createNeonDriver(() => createPgliteExecutor(db))
    const res = await driver.probe(cfg())
    expect(res).toMatchObject({ ok: true, inspection: { state: 'outdated', dbVersion: 2 } })
    expect(res.ok && canSaveSource(res.inspection)).toBe(false)
  })

  it('maps unavailable to unreachable', async () => {
    const failing = failingExecutor(new StorageError('unavailable'))
    const res = await createNeonDriver(() => failing).probe(cfg())
    expect(res).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  it('maps 28P01 to auth and cuts the password out of the message', async () => {
    const err = Object.assign(new Error('password authentication failed for user "u" (secret)'), { code: '28P01' })
    const res = await createNeonDriver(() => failingExecutor(err)).probe(cfg())
    expect(res).toMatchObject({ ok: false, reason: 'auth' })
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it('maps 3D000 to no_database and the rest to failed', async () => {
    const nodb = Object.assign(new Error('x'), { code: '3D000' })
    expect(await createNeonDriver(() => failingExecutor(nodb)).probe(cfg())).toMatchObject({ reason: 'no_database' })
    expect(await createNeonDriver(() => failingExecutor(new Error('boom'))).probe(cfg())).toMatchObject({ reason: 'failed' })
  })
})

describe('canSaveSource', () => {
  it('saves an empty, older, current or newer source, not a foreign or pre-release one', () => {
    const v = { dbVersion: 3, appVersion: 3 }
    expect(canSaveSource({ state: 'empty' })).toBe(true)
    expect(canSaveSource({ state: 'older', ...v })).toBe(true)
    expect(canSaveSource({ state: 'current', ...v })).toBe(true)
    expect(canSaveSource({ state: 'newer', ...v })).toBe(true)
    expect(canSaveSource({ state: 'foreign' })).toBe(false)
    expect(canSaveSource({ state: 'outdated', ...v })).toBe(false)
  })
})

describe('redactSecret', () => {
  it('replaces raw and decoded password forms', () => {
    const cs = 'postgresql://u:p%40ss@h/db'
    expect(redactSecret('bad p%40ss and p@ss', cs)).toBe('bad *** and ***')
  })
  it('returns the message unchanged without a password', () => {
    expect(redactSecret('hello', 'postgresql://u@h/db')).toBe('hello')
    expect(redactSecret('hello', 'garbage')).toBe('hello')
  })
})

function failingExecutor(error: Error): PgExecutor {
  const fail = async (): Promise<never> => {
    throw error
  }
  return { query: fail, batch: fail, readBatch: fail, close: async () => {} }
}

describe('createNeonDriver connect redaction', () => {
  it('redacts the password from an error thrown while making the executor', async () => {
    const driver = createNeonDriver(() => {
      throw new Error('Database connection string is not a valid URL: postgresql://u:secret@h/db')
    })
    const error = await driver.connect(cfg()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).message).not.toContain('secret')
  })
})

describe('photoStoreProblem', () => {
  const cl = (cloudinaryCloudName: string | null, cloudinaryUploadPreset: string | null) =>
    photoStoreProblem({ photoStore: 'cloudinary', cloudinaryCloudName, cloudinaryUploadPreset })

  it('accepts Cloudinary with both fields, or with none (photos are optional)', () => {
    expect(cl('my-cloud_1', 'preset')).toBeNull()
    expect(cl(null, null)).toBeNull()
    expect(cl('  ', '')).toBeNull()
  })
  it('names the missing Cloudinary field and a cloud name that is not one', () => {
    expect(cl('', 'preset')).toBe('cloudinaryCloud')
    expect(cl('my-cloud', '')).toBe('cloudinaryPreset')
    expect(cl('https://res.cloudinary.com/x', 'preset')).toBe('cloudinaryCloudFormat')
    expect(cl('my.cloud', 'preset')).toBe('cloudinaryCloudFormat')
  })
  it('has nothing to cross-check for the other stores', () => {
    expect(photoStoreProblem({ photoStore: 'imgur', cloudinaryCloudName: 'bad name', cloudinaryUploadPreset: null })).toBeNull()
    expect(photoStoreProblem({ cloudinaryCloudName: null, cloudinaryUploadPreset: null })).toBeNull()
  })
})
