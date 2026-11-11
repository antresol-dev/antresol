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
      return db.transaction(async (tx) => {
        const out: Record<string, unknown>[][] = []
        for (const s of statements) out.push((await tx.query<Record<string, unknown>>(s.text, s.params)).rows)
        return out
      })
    },
    async readBatch(statements) {
      return db.transaction(async (tx) => {
        await tx.query('set transaction isolation level repeatable read, read only')
        const out: Record<string, unknown>[][] = []
        for (const s of statements) out.push((await tx.query<Record<string, unknown>>(s.text, s.params)).rows)
        return out
      })
    },
    async close() {
      await db.close()
    },
  }
}
