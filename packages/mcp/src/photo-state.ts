import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Id, StoredFile } from '@antresol/core'

/** A file in the photo store plus the picture's size as stored. */
export type StoredUpload = StoredFile & { width: number; height: number }

export interface PhotoState {
  /** The upload made for this key (photo store + content hash), if any. */
  get(key: string): StoredUpload | null
  /** Remembers an upload so the same content is never uploaded again. Does not mark anything as used. */
  put(key: string, upload: StoredUpload): void
  /** These file paths now belong to saved draft lines (shown as `usedIn` by list_photos); one write for all. Throws when the file cannot be written. */
  markUsed(entries: { path: string; intakeId: Id; lineId: Id }[]): void
  /** File path -> the line it was last attached to. */
  usedPaths(): Map<string, { intakeId: Id; lineId: Id }>
}

interface Stored {
  uploads: Record<string, StoredUpload>
  used: Record<string, { intakeId: Id; lineId: Id }>
}

const FILE = 'mcp-photos.json'

const isRecord = (v: unknown): v is Record<string, never> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Remembers uploads (by the key the caller makes: store identity + content hash) and used paths in
 *  `<stateDir>/mcp-photos.json`. Other server processes (Claude Desktop and Claude Code at once) share the file, so every
 *  call reads it again and every write merges into what is there (written via a temporary file and a rename). A missing
 *  file is an empty state; an unreadable one is moved aside to `mcp-photos.corrupt-<time>.json` once, with a note on
 *  stderr, and the state starts empty. */
export function createPhotoState(stateDir: string): PhotoState {
  const file = path.join(stateDir, FILE)
  const load = (): Stored => {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      return { uploads: {}, used: {} }
    }
    try {
      const parsed: unknown = JSON.parse(text)
      if (isRecord(parsed) && isRecord(parsed.uploads) && isRecord(parsed.used)) return { uploads: parsed.uploads, used: parsed.used }
    } catch {
      // falls through to the corrupt case
    }
    const aside = path.join(stateDir, `mcp-photos.corrupt-${Date.now()}.json`)
    try {
      renameSync(file, aside)
      console.error(`Antresol MCP: ${file} could not be read; it was moved to ${aside} and the photo memory starts empty.`)
    } catch {
      console.error(`Antresol MCP: ${file} could not be read; the photo memory starts empty.`)
    }
    return { uploads: {}, used: {} }
  }
  const save = (state: Stored) => {
    mkdirSync(stateDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, file)
  }
  return {
    get: (key) => load().uploads[key] ?? null,
    put(key, upload) {
      const state = load()
      save({ ...state, uploads: { ...state.uploads, [key]: upload } })
    },
    markUsed(entries) {
      if (entries.length === 0) return
      const state = load()
      const used = { ...state.used }
      for (const e of entries) used[e.path] = { intakeId: e.intakeId, lineId: e.lineId }
      save({ ...state, used })
    },
    usedPaths: () => new Map(Object.entries(load().used)),
  }
}
