import {
  StorageError,
  type InventoryStorage,
  type SchemaInspection,
  type SchemaStatus,
} from '@graymatter/core'
import {
  createNeonHttpExecutor,
  inspectSchema,
  openPostgresStorage,
  type PgExecutor,
} from '@graymatter/storage-postgres'
import type { SourceConfig } from './types'

export type ConnectionStringProblem = 'empty' | 'not_postgres_url' | 'missing_password' | 'missing_database'

export function checkConnectionString(input: string): ConnectionStringProblem | null {
  const value = input.trim()
  if (!value) return 'empty'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'not_postgres_url'
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return 'not_postgres_url'
  if (!url.password) return 'missing_password'
  if (url.pathname === '' || url.pathname === '/') return 'missing_database'
  return null
}

export const PROBE_FAILURES = ['unreachable', 'auth', 'no_database', 'failed'] as const
export type ProbeFailure = (typeof PROBE_FAILURES)[number]
export type SourceProbe =
  | { ok: true; inspection: SchemaInspection }
  | { ok: false; reason: ProbeFailure; message: string }

export interface SourceConnection {
  storage: InventoryStorage
  status: SchemaStatus
  close(): Promise<void>
}

export interface SourceDriver {
  /** Read-only: inspects the schema, never writes. */
  probe(config: SourceConfig): Promise<SourceProbe>
  /** openPostgresStorage: creates or upgrades the schema; rejects StorageError('incompatible') for a foreign database. */
  connect(config: SourceConfig): Promise<SourceConnection>
}

/** Replaces the connection string's password (raw and URL-decoded forms) with '***'. */
export function redactSecret(message: string, connectionString: string): string {
  let password: string
  try {
    password = new URL(connectionString.trim()).password
  } catch {
    return message
  }
  if (!password) return message
  const forms = new Set([password])
  try {
    forms.add(decodeURIComponent(password))
  } catch {
    // keep the raw form only
  }
  let result = message
  for (const form of [...forms].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(form).join('***')
  }
  return result
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
    const cause = (error as { cause?: unknown }).cause
    if (cause && cause !== error) return errorCode(cause)
  }
  return undefined
}

function failureReason(error: unknown): ProbeFailure {
  const code = errorCode(error)
  if (code === 'unavailable') return 'unreachable'
  if (code === '28P01') return 'auth'
  if (code === '3D000') return 'no_database'
  return 'failed'
}

/** Probe against a freshly made executor: read-only, executor closed afterwards. */
export async function probeWithExecutor(
  makeExecutor: () => Promise<PgExecutor> | PgExecutor,
  config: SourceConfig,
): Promise<SourceProbe> {
  let exec: PgExecutor | null = null
  try {
    exec = await makeExecutor()
    return { ok: true, inspection: await inspectSchema(exec) }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    return { ok: false, reason: failureReason(error), message: redactSecret(raw, config.connectionString) }
  } finally {
    await exec?.close().catch(() => {})
  }
}

export function createNeonDriver(
  makeExecutor: (connectionString: string) => PgExecutor = createNeonHttpExecutor,
): SourceDriver {
  return {
    probe: (config) => probeWithExecutor(() => makeExecutor(config.connectionString), config),
    async connect(config) {
      const exec = makeExecutor(config.connectionString)
      try {
        const { storage, status } = await openPostgresStorage(exec)
        return { storage, status, close: () => exec.close() }
      } catch (error) {
        await exec.close().catch(() => {})
        if (error instanceof StorageError) throw error
        const raw = error instanceof Error ? error.message : String(error)
        throw new StorageError('failed', redactSecret(raw, config.connectionString))
      }
    },
  }
}
