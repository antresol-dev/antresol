import type { PGlite } from '@electric-sql/pglite'
import type { PgExecutor } from '../executor'
import type { Statement } from '../sql'

export function createPgliteExecutor(db: PGlite): PgExecutor {
  return {
    async query<Row = Record<string, unknown>>(s: Statement) {
      const result = await db.query<Row>(s.text, s.params)
      return result.rows
    },
    async batch(statements) {
      await db.transaction(async (tx) => {
        for (const s of statements) await tx.query(s.text, s.params)
      })
    },
    async close() {
      await db.close()
    },
  }
}
