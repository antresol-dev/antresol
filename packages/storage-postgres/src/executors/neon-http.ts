import { neon } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'
import { isFetchFailure, unavailable } from './errors'
import { timeoutSignal } from './timeout'

/** A request that has not answered by then counts as unreachable. */
export const HTTP_TIMEOUT_MS = 20_000

export function createNeonHttpExecutor(connectionString: string, options?: { timeoutMs?: number }): PgExecutor {
  const timeoutMs = options?.timeoutMs ?? HTTP_TIMEOUT_MS
  const sql = neon(connectionString, { disableWarningInBrowsers: true })
  // A fresh signal per call: the timer starts when the request does and is cleared when it ends.
  const guarded = async <T>(run: (fetchOptions: { signal: AbortSignal }) => Promise<T>): Promise<T> => {
    const { signal, clear } = timeoutSignal(timeoutMs)
    try {
      return await run({ signal })
    } catch (e) {
      throw isFetchFailure(e) ? unavailable(e) : e
    } finally {
      clear()
    }
  }
  return {
    query: <Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) =>
      guarded(async (fetchOptions) => (await sql.query(s.text, s.params, { fetchOptions })) as Row[]),
    async batch(statements) {
      if (statements.length === 0) return
      await guarded(async (fetchOptions) => {
        await sql.transaction(
          statements.map((s) => sql.query(s.text, s.params)),
          { fetchOptions },
        )
      })
    },
    async readBatch(statements) {
      if (statements.length === 0) return []
      return guarded(
        async (fetchOptions) =>
          (await sql.transaction(
            statements.map((s) => sql.query(s.text, s.params)),
            { isolationLevel: 'RepeatableRead', readOnly: true, fetchOptions },
          )) as Record<string, unknown>[][],
      )
    },
    async close() {},
  }
}
