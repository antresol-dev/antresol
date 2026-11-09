import { neon } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'

export function createNeonHttpExecutor(connectionString: string): PgExecutor {
  const sql = neon(connectionString)
  return {
    async query<Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) {
      return (await sql.query(s.text, s.params)) as Row[]
    },
    async batch(statements) {
      if (statements.length === 0) return
      await sql.transaction(statements.map((s) => sql.query(s.text, s.params)))
    },
    async close() {},
  }
}
