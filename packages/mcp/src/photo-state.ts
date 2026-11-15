import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Id, StoredFile } from '@antresol/core'

/** A file in the photo store plus the picture's size as stored. */
export type StoredUpload = StoredFile & { width: number; height: number }

export interface PhotoState {
  /** The upload made for a file with this content, if any. */
  get(sha256: string): StoredUpload | null
  /** Remembers an upload so the same content is never uploaded again. Does not mark anything as used. */
  put(sha256: string, upload: StoredUpload): void
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

/** Remembers uploads by content hash and used paths in `<stateDir>/mcp-photos.json` (written whole, via a temporary
 *  file and a rename). A missing, unreadable or older-format file is an empty state. */
export function createPhotoState(stateDir: string): PhotoState {
  const file = path.join(stateDir, FILE)
  let state: Stored = { uploads: {}, used: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Stored> | null
    if (parsed && typeof parsed.uploads === 'object' && parsed.uploads && typeof parsed.used === 'object' && parsed.used) state = { uploads: parsed.uploads, used: parsed.used }
  } catch {
    state = { uploads: {}, used: {} }
  }
  const save = () => {
    mkdirSync(stateDir, { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, file)
  }
  return {
    get: (sha256) => state.uploads[sha256] ?? null,
    put(sha256, upload) {
      state = { ...state, uploads: { ...state.uploads, [sha256]: upload } }
      save()
    },
    markUsed(entries) {
      if (entries.length === 0) return
      const used = { ...state.used }
      for (const e of entries) used[e.path] = { intakeId: e.intakeId, lineId: e.lineId }
      state = { ...state, used }
      save()
    },
    usedPaths: () => new Map(Object.entries(state.used)),
  }
}
