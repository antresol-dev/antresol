import { createStore, get, set, type UseStore } from 'idb-keyval'

/** One line of the on-device error log. */
export interface DiagnosticEntry {
  /** ISO time. */
  at: string
  /** Where it happened: 'connect', 'storage', 'write'… */
  where: string
  code: string
  message: string
}

export const MAX_ENTRIES = 200
const MAX_MESSAGE = 500
const KEY = 'errors'

export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

export function memoryKeyValue(): KeyValue {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    set: async (key, value) => {
      map.set(key, value)
    },
  }
}

/** The device store of the log and the traffic counter (IndexedDB 'graymatter-diag'/'kv'), memory where there is none. */
export function deviceKeyValue(): KeyValue {
  let store: UseStore | null = null
  let fallback: KeyValue | null = null
  const backend = (): { idb: UseStore } | { mem: KeyValue } => {
    if (fallback) return { mem: fallback }
    try {
      if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('no indexedDB')
      store ??= createStore('graymatter-diag', 'kv')
      return { idb: store }
    } catch {
      fallback = memoryKeyValue()
      return { mem: fallback }
    }
  }
  return {
    async get<T>(key: string) {
      const b = backend()
      try {
        return 'idb' in b ? await get<T>(key, b.idb) : await b.mem.get<T>(key)
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      const b = backend()
      try {
        if ('idb' in b) await set(key, value, b.idb)
        else await b.mem.set(key, value)
      } catch {
        // The log is best-effort; it never breaks what it describes.
      }
    },
  }
}

const URL_PATTERN = /postgres(?:ql)?:\/\/\S+/gi
const SECRET_KEY = /key|secret|token|password|passwd|preset|auth/i
/** The photo stores' settings, whatever their names look like (an Imgur Client-ID or a Cloudinary cloud name has no
 *  "key" in it): every one is a credential of the person's account. */
const PHOTO_FIELDS: ReadonlySet<string> = new Set([
  'uploadcarePublicKey',
  'cloudinaryCloudName',
  'cloudinaryUploadPreset',
  'imgurClientId',
])
/** Shorter values would blank out ordinary words. */
const MIN_SECRET_LENGTH = 4

/** Removes connection strings and the given secret values (also URL-encoded) from a text. */
export function scrub(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(URL_PATTERN, '[connection string]')
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_LENGTH) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) out = out.split(form).join('[hidden]')
  }
  return out
}

/**
 * The secret values held by a source's settings: its connection string, the password inside it, and every other text
 * field whose name says it is a key, token, secret or password (new photo providers add such fields).
 */
export function secretsOf(config: object): string[] {
  const out: string[] = []
  for (const [name, value] of Object.entries(config)) {
    if (typeof value !== 'string' || value === '') continue
    if (name === 'connectionString') {
      out.push(value)
      try {
        const url = new URL(value)
        if (url.password) out.push(decodeURIComponent(url.password), url.password)
      } catch {
        // Not a URL: the whole text is already a secret.
      }
    } else if (PHOTO_FIELDS.has(name) || SECRET_KEY.test(name)) out.push(value)
  }
  return out
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && code !== '') return code
  return error instanceof Error && error.name ? error.name : 'error'
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    // The generic 'database unreachable' hides why; the driver's own words are in the cause.
    const cause = (error as { cause?: unknown }).cause
    return cause instanceof Error ? `${error.message} (${cause.name}: ${cause.message})` : error.message
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    return String(error)
  }
}

export interface Diagnostics {
  /** Fire and forget: never throws, never waits. */
  logError(where: string, error: unknown): void
  /** Newest first. */
  readErrors(): Promise<DiagnosticEntry[]>
  clear(): Promise<void>
}

export function createDiagnostics(deps: { kv: KeyValue; now?: () => Date; secrets?: () => readonly string[] }): Diagnostics {
  const now = deps.now ?? (() => new Date())
  // Writes go one after another: two quick errors must not overwrite each other.
  let chain: Promise<void> = Promise.resolve()
  const enqueue = (job: () => Promise<void>): void => {
    chain = chain.then(job).catch(() => {})
  }
  return {
    logError(where, error) {
      let entry: DiagnosticEntry
      try {
        const secrets = deps.secrets?.() ?? []
        entry = {
          at: now().toISOString(),
          where: scrub(where, secrets),
          code: scrub(codeOf(error), secrets),
          message: scrub(textOf(error), secrets).slice(0, MAX_MESSAGE),
        }
      } catch {
        return
      }
      enqueue(async () => {
        const kept = (await deps.kv.get<DiagnosticEntry[]>(KEY)) ?? []
        await deps.kv.set(KEY, [...kept, entry].slice(-MAX_ENTRIES))
      })
    },
    async readErrors() {
      await chain
      return [...((await deps.kv.get<DiagnosticEntry[]>(KEY)) ?? [])].reverse()
    },
    async clear() {
      enqueue(() => deps.kv.set(KEY, []))
      await chain
    },
  }
}

let secretSource: () => readonly string[] = () => []
/** The workspace says where the secret values of the sources' settings are read from. */
export function setSecretSource(source: () => readonly string[]): void {
  secretSource = source
}

const shared = createDiagnostics({ kv: deviceKeyValue(), secrets: () => secretSource() })
export const logError = shared.logError
export const readErrors = shared.readErrors
export const clearErrors = shared.clear

/** The log as text for Copy and Share. */
export function formatErrors(entries: readonly DiagnosticEntry[]): string {
  return entries.map((e) => `${e.at}  ${e.where}  ${e.code}  ${e.message}`).join('\n')
}
