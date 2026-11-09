import type { Statement } from './sql'

export interface PgExecutor {
  query<Row = Record<string, unknown>>(s: Statement): Promise<Row[]>
  /** Atomic: all statements succeed or none is applied. */
  batch(statements: Statement[]): Promise<void>
  close(): Promise<void>
}
