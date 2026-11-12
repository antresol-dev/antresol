import type { Statement } from './sql'

export interface PgExecutor {
  query<Row = Record<string, unknown>>(s: Statement): Promise<Row[]>
  /** Atomic: all statements succeed or none is applied. Returns the rows of each statement, in order ([] for statements without rows). */
  batch(statements: Statement[]): Promise<Record<string, unknown>[][]>
  /** Read-only statements in one REPEATABLE READ READ ONLY transaction; rows of each statement, in order. One round trip on Neon HTTP. */
  readBatch(statements: Statement[]): Promise<Record<string, unknown>[][]>
  close(): Promise<void>
}
