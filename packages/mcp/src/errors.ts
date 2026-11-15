import { FileError, StorageError, type FileErrorCode, type StorageErrorCode } from '@antresol/core'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ServerConfig } from './config'

/** An error with a message written for the model: it is shown as is. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

const STORAGE_TEXT: Record<StorageErrorCode, string> = {
  read_only: 'The database was made by a newer version of Antresol and is read-only here. Update the MCP server.',
  unavailable: 'The database is not reachable. Check the network and try again.',
  not_found: 'Not found in the database: it may have been deleted in the app. Call refresh and look it up again.',
  incompatible: 'The database is not compatible with this version of the MCP server.',
  outdated: 'The database was made by a pre-release build and has to be reset in the app first.',
  failed: 'The database refused the request.',
  not_empty: 'The database already holds data.',
  conflict: 'Something else changed this at the same time. Call refresh and try again.',
}

const FILE_TEXT: Record<FileErrorCode, string> = {
  no_store: 'No photo store is set up. Open Settings → Connect AI in the app and copy the connection key again.',
  unsupported: 'This file type is not supported for photos.',
  too_large: 'The photo is too large.',
  too_large_to_decode: 'The photo is too large to be processed.',
  rejected: 'The photo store rejected the file.',
  unavailable: 'The photo store is not reachable. Try again later.',
  failed: 'The photo could not be uploaded.',
}

/** Every string in `secrets` (connection string, keys) becomes `[hidden]`; the longest go first. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text
  for (const secret of [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length)) out = out.split(secret).join('[hidden]')
  return out
}

/** What must never reach a tool result or the log: the connection string, its password and the photo store keys. */
export function secretsOf(config: ServerConfig): string[] {
  const c = config.connection
  if (!c) return config.connectionKey ? [config.connectionKey] : []
  const secrets: (string | null | undefined)[] = [config.connectionKey ?? undefined, c.connectionString, c.uploadcarePublicKey, c.cloudinaryUploadPreset, c.imgurClientId, c.imgbbApiKey]
  try {
    const url = new URL(c.connectionString)
    secrets.push(url.password, decodeURIComponent(url.password), url.username)
  } catch {
    // not a URL: the whole string is hidden anyway
  }
  return secrets.flatMap((s) => (typeof s === 'string' && s.trim().length >= 4 ? [s.trim()] : []))
}

const WRITE_UNAVAILABLE = 'The database did not answer — the change may have been saved. Check get_intake before retrying.'

function messageOf(e: unknown, write: boolean): string {
  if (e instanceof ToolError) return e.message
  if (write && e instanceof StorageError && e.code === 'unavailable') return WRITE_UNAVAILABLE
  if (e instanceof StorageError) return e.message === e.code ? STORAGE_TEXT[e.code] : `${STORAGE_TEXT[e.code]} (${e.message})`
  if (e instanceof FileError) return e.message === e.code ? FILE_TEXT[e.code] : `${FILE_TEXT[e.code]} (${e.message})`
  if (e instanceof Error) return `Unexpected error: ${e.message}`
  return 'Unexpected error.'
}

/** An error as a tool result: `isError`, text without secrets. */
export function toToolResult(e: unknown, secrets: string[], options: { write?: boolean } = {}): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: scrub(messageOf(e, options.write ?? false), secrets) }] }
}

/** A result as a tool answers it: JSON without indentation. */
export function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}
