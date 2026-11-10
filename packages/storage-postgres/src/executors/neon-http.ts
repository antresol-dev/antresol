import { neon } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'
import { isFetchFailure, unavailable } from './errors'

export function createNeonHttpExecutor(connectionString: string): PgExecutor {
  const sql = neon(connectionString, { disableWarningInBrowsers: true })
  return {
    async query<Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) {
      try {
        return (await sql.query(s.text, s.params)) as Row[]
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async batch(statements) {
      if (statements.length === 0) return
      try {
        await sql.transaction(statements.map((s) => sql.query(s.text, s.params)))
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async readBatch(statements) {
      if (statements.length === 0) return []
      try {
        return (await sql.transaction(
          statements.map((s) => sql.query(s.text, s.params)),
          { isolationLevel: 'RepeatableRead', readOnly: true },
        )) as Record<string, unknown>[][]
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async close() {},
  }
}
