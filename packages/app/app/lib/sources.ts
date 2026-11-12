import {
  StorageError,
  type InventoryStorage,
  type SchemaInspection,
  type SchemaStatus,
} from '@antresol/core'
import {
  createNeonHttpExecutor,
  inspectSchema,
  openPostgresStorage,
  type PgExecutor,
} from '@antresol/storage-postgres'
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

/** A Cloudinary store takes two fields and is useless with one: the store would silently be none. Both empty is fine
 *  (photos are optional); otherwise both are required and the cloud name has the shape of one (it goes into an address).
 *  The `sourceForm.problem.*` key of what to fix, or null. The other stores have one field and nothing to cross-check. */
export function photoStoreProblem(
  c: Pick<SourceConfig, 'photoStore' | 'cloudinaryCloudName' | 'cloudinaryUploadPreset'>,
): 'cloudinaryCloud' | 'cloudinaryCloudFormat' | 'cloudinaryPreset' | null {
  if (c.photoStore !== 'cloudinary') return null
  const cloud = c.cloudinaryCloudName?.trim() ?? ''
  const preset = c.cloudinaryUploadPreset?.trim() ?? ''
  if (cloud === '' && preset === '') return null
  if (cloud === '') return 'cloudinaryCloud'
  if (!/^[A-Za-z0-9_-]+$/.test(cloud)) return 'cloudinaryCloudFormat'
  return preset === '' ? 'cloudinaryPreset' : null
}

export const PROBE_FAILURES = ['unreachable', 'auth', 'no_database', 'failed'] as const
export type ProbeFailure = (typeof PROBE_FAILURES)[number]
export type SourceProbe =
  | { ok: true; inspection: SchemaInspection }
  | { ok: false; reason: ProbeFailure; message: string }

/** Whether a source with this schema can be saved: not a database with other tables, nor one a pre-release build made
 *  (opening it would fail with `outdated`). */
export function canSaveSource(inspection: SchemaInspection): boolean {
  return inspection.state !== 'foreign' && inspection.state !== 'outdated'
}

export interface SourceConnection {
  storage: InventoryStorage
  /** The schema as the connection found it when it opened. */
  status: SchemaStatus
  /** Read-only look at the schema now, through this connection (inspectSchema): a refresh that reuses the connection
   *  checks the schema is still the one it opened on. Rejects like `connect`, free of the password. */
  inspect(): Promise<SchemaInspection>
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

/** Error codes along the cause chain, outermost first (a StorageError('failed') wraps the driver's own code). */
function errorCodes(error: unknown): string[] {
  const codes: string[] = []
  for (let e: unknown = error, depth = 0; typeof e === 'object' && e !== null && depth < 5; depth++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') codes.push(code)
    const cause = (e as { cause?: unknown }).cause
    if (!cause || cause === e) break
    e = cause
  }
  return codes
}

export type FailureReason = ProbeFailure | 'incompatible' | 'outdated'

/** Classifies a source failure for the UI; the same mapping the probe uses. */
export function classifyFailure(error: unknown): FailureReason {
  const codes = errorCodes(error)
  if (codes.includes('unavailable')) return 'unreachable'
  if (codes.includes('28P01')) return 'auth'
  if (codes.includes('3D000')) return 'no_database'
  if (codes.includes('incompatible')) return 'incompatible'
  if (codes.includes('outdated')) return 'outdated'
  return 'failed'
}

function failureReason(error: unknown): ProbeFailure {
  const reason = classifyFailure(error)
  return reason === 'incompatible' || reason === 'outdated' ? 'failed' : reason
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

/** A driver failure as a StorageError free of the connection string's password. */
function sourceFailure(error: unknown, config: SourceConfig): StorageError {
  if (error instanceof StorageError) return error
  const raw = error instanceof Error ? error.message : String(error)
  const failure = new StorageError('failed', redactSecret(raw, config.connectionString))
  // Only the classifying code survives, never the original error with its text.
  const code = errorCodes(error).find((c) => c !== 'failed')
  if (code) failure.cause = { code }
  return failure
}

export function createNeonDriver(
  makeExecutor: (connectionString: string, options?: { onTraffic?: (bytes: number) => void }) => PgExecutor = createNeonHttpExecutor,
  hooks?: { onTraffic?: (sourceId: string, bytes: number) => void },
): SourceDriver {
  return {
    probe: (config) => probeWithExecutor(() => makeExecutor(config.connectionString), config),
    async connect(config) {
      let exec: PgExecutor | null = null
      try {
        exec = makeExecutor(
          config.connectionString,
          hooks?.onTraffic ? { onTraffic: (bytes) => hooks.onTraffic?.(config.id, bytes) } : undefined,
        )
        const { storage, status } = await openPostgresStorage(exec)
        const opened = exec
        const inspect = async (): Promise<SchemaInspection> => {
          try {
            return await inspectSchema(opened)
          } catch (error) {
            throw sourceFailure(error, config)
          }
        }
        return { storage, status, inspect, close: () => opened.close() }
      } catch (error) {
        await exec?.close().catch(() => {})
        throw sourceFailure(error, config)
      }
    },
  }
}
