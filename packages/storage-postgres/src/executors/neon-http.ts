import { neon, neonConfig } from '@neondatabase/serverless'
import type { PgExecutor } from '../executor'
import { isFetchFailure, unavailable } from './errors'

/** A write (or a single statement) that has not started to answer by then counts as unreachable. */
export const HTTP_FIRST_BYTE_MS = 15_000
/** Everything about one request, the download of its body included: a slow snapshot read is not an outage until then. */
export const HTTP_TOTAL_MS = 90_000

export interface NeonHttpOptions {
  /** Writes and single statements: abort when no response has started after this long. */
  firstByteMs?: number
  /** Reads of a snapshot: the one limit, body download included. Writes keep it as an upper bound. */
  totalMs?: number
  /** Called with the size of each response body once it has been read (an estimate of the traffic used). */
  onTraffic?: (bytes: number) => void
}

interface HookedInit extends RequestInit {
  onHeaders?: () => void
  onBytes?: (bytes: number) => void
}

const HOOKED = Symbol('antresol.fetch-hook')

/**
 * The driver reads the response body itself, so "first byte" and the byte count have to be seen from the fetch function it
 * calls. Wraps `neonConfig.fetchFunction` once; per-request hooks travel in the init object (`fetchOptions` is spread into it).
 */
function installFetchHook(): void {
  const current = neonConfig.fetchFunction as ((url: unknown, init?: HookedInit) => Promise<Response>) | undefined
  if (current && (current as unknown as Record<symbol, unknown>)[HOOKED]) return
  const base = current ?? ((url: unknown, init?: RequestInit) => fetch(url as RequestInfo, init))
  const hooked = async (url: unknown, init?: HookedInit): Promise<Response> => {
    const { onHeaders, onBytes, ...rest } = init ?? {}
    const response = await base(url, rest)
    onHeaders?.()
    if (!onBytes || !response.body) return response
    let bytes = 0
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength
        controller.enqueue(chunk)
      },
      flush() {
        onBytes(bytes)
      },
    })
    return new Response(response.body.pipeThrough(counter), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  ;(hooked as unknown as Record<symbol, unknown>)[HOOKED] = true
  neonConfig.fetchFunction = hooked
}

export function createNeonHttpExecutor(connectionString: string, options?: NeonHttpOptions): PgExecutor {
  const firstByteMs = options?.firstByteMs ?? HTTP_FIRST_BYTE_MS
  const totalMs = options?.totalMs ?? HTTP_TOTAL_MS
  const sql = neon(connectionString, { disableWarningInBrowsers: true })

  // A fresh signal per call: the timers start when the request does and are cleared when it ends.
  const guarded = async <T>(
    kind: 'write' | 'read',
    run: (fetchOptions: Record<string, unknown>) => Promise<T>,
  ): Promise<T> => {
    installFetchHook()
    const controller = new AbortController()
    const abort = (): void => controller.abort(new DOMException('The operation timed out', 'TimeoutError'))
    const total = setTimeout(abort, totalMs)
    const firstByte = kind === 'write' ? setTimeout(abort, firstByteMs) : null
    try {
      return await run({
        signal: controller.signal,
        onHeaders: () => {
          if (firstByte) clearTimeout(firstByte)
        },
        onBytes: options?.onTraffic,
      })
    } catch (e) {
      throw isFetchFailure(e) ? unavailable(e) : e
    } finally {
      clearTimeout(total)
      if (firstByte) clearTimeout(firstByte)
    }
  }
  return {
    query: <Row = Record<string, unknown>>(s: { text: string; params: unknown[] }) =>
      guarded('write', async (fetchOptions) => (await sql.query(s.text, s.params, { fetchOptions })) as Row[]),
    async batch(statements) {
      if (statements.length === 0) return []
      return guarded(
        'write',
        async (fetchOptions) =>
          (await sql.transaction(
            statements.map((s) => sql.query(s.text, s.params)),
            { fetchOptions },
          )) as Record<string, unknown>[][],
      )
    },
    async readBatch(statements) {
      if (statements.length === 0) return []
      return guarded(
        'read',
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
