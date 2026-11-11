import { describe, expect, it } from 'vitest'
import { sql } from '../src/sql'
import { makeExecutor } from './helpers'

describe('batch (PGlite)', () => {
  it('returns the rows of each statement in order', async () => {
    const exec = await makeExecutor()
    const result = await exec.batch([
      sql`create temp table gm_probe (x int) on commit drop`,
      sql`insert into gm_probe values (1), (2)`,
      sql`update gm_probe set x = x + 1 where x = 2`,
      sql`select x from gm_probe order by x`,
    ])
    expect(result.length).toBe(4)
    expect(result[1]).toEqual([])
    expect(result[2]).toEqual([])
    expect(result[3]).toEqual([{ x: 1 }, { x: 3 }])
  })

  it('a failing statement applies nothing and rejects', async () => {
    const exec = await makeExecutor()
    await exec.batch([sql`create table gm_probe (x int primary key)`])
    await expect(exec.batch([sql`insert into gm_probe values (1)`, sql`insert into gm_probe values (1)`])).rejects.toThrow()
    expect(await exec.query(sql`select x from gm_probe`)).toEqual([])
  })
})
