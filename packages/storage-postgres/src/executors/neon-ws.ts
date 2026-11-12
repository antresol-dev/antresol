import { neonConfig, Pool } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'
import { unavailable } from './errors'

export function createNeonWsExecutor(connectionString: string): PgExecutor {
  // Pool has no per-instance option for this; the driver exposes it as a global setting.
  neonConfig.disableWarningInBrowsers = true
  const pool = new Pool({ connectionString })
  return {
    async query<Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) {
      const result = await pool.query(s.text, s.params)
      return result.rows as Row[]
    },
    async batch(statements) {
      let client
      try {
        client = await pool.connect()
      } catch (e) {
        throw unavailable(e)
      }
      try {
        await client.query('BEGIN')
        const out: Record<string, unknown>[][] = []
        for (const s of statements) out.push((await client.query(s.text, s.params)).rows)
        await client.query('COMMIT')
        return out
      } catch (e) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // keep the original error
        }
        throw e
      } finally {
        client.release()
      }
    },
    async readBatch(statements) {
      let client
      try {
        client = await pool.connect()
      } catch (e) {
        throw unavailable(e)
      }
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const out: Record<string, unknown>[][] = []
        for (const s of statements) out.push((await client.query(s.text, s.params)).rows)
        await client.query('COMMIT')
        return out
      } catch (e) {
        try {
          await client.query('ROLLBACK')
        } catch {
          // keep the original error
        }
        throw e
      } finally {
        client.release()
      }
    },
    async close() {
      await pool.end()
    },
  }
}
