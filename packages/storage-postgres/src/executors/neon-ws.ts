import { Pool } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'

export function createNeonWsExecutor(connectionString: string): PgExecutor {
  const pool = new Pool({ connectionString })
  return {
    async query<Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) {
      const result = await pool.query(s.text, s.params)
      return result.rows as Row[]
    },
    async batch(statements) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const s of statements) await client.query(s.text, s.params)
        await client.query('COMMIT')
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
