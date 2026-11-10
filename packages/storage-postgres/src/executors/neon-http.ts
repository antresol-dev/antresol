import { neon } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'
import { isFetchFailure, unavailable } from './errors'

/** A request that has not answered by then counts as unreachable. */
export const HTTP_TIMEOUT_MS = 20_000

export function createNeonHttpExecutor(connectionString: string, options?: { timeoutMs?: number }): PgExecutor {
  const timeoutMs = options?.timeoutMs ?? HTTP_TIMEOUT_MS
  const sql = neon(connectionString, { disableWarningInBrowsers: true })
  // A fresh signal per call: the timer starts when the request does.
  const fetchOptions = () => ({ signal: AbortSignal.timeout(timeoutMs) })
  return {
    async query<Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) {
      try {
        return (await sql.query(s.text, s.params, { fetchOptions: fetchOptions() })) as Row[]
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async batch(statements) {
      if (statements.length === 0) return
      try {
        await sql.transaction(
          statements.map((s) => sql.query(s.text, s.params)),
          { fetchOptions: fetchOptions() },
        )
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async readBatch(statements) {
      if (statements.length === 0) return []
      try {
        return (await sql.transaction(
          statements.map((s) => sql.query(s.text, s.params)),
          { isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions: fetchOptions() },
        )) as Record<string, unknown>[][]
      } catch (e) {
        throw isFetchFailure(e) ? unavailable(e) : e
      }
    },
    async close() {},
  }
}
