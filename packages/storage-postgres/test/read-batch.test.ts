import { describe, expect, it } from 'vitest'
import { sql } from '../src/sql'
import { makeExecutor } from './helpers'

describe('readBatch (PGlite)', () => {
  it('returns the rows of each statement, in order', async () => {
    const exec = await makeExecutor()
    expect(await exec.readBatch([sql`select 1 as a`, sql`select 2 as b`])).toEqual([[{ a: 1 }], [{ b: 2 }]])
  })

  it('rejects a write and leaves no trace', async () => {
    const exec = await makeExecutor()
    await exec.batch([sql`create table antresol_meta (key text primary key, value text)`])
    await expect(exec.readBatch([sql`insert into antresol_meta (key, value) values ('x', 'y')`])).rejects.toThrow(/read-only transaction/)
    expect(await exec.query(sql`select 1 from antresol_meta where key = 'x'`)).toEqual([])
  })
})
