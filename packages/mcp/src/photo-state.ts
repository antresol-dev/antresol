import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Id, StoredFile } from '@antresol/core'

/** A file in the photo store plus the picture's size as stored. */
export type StoredUpload = StoredFile & { width: number; height: number }

type Entry = StoredUpload & { intakeId: Id; lineId: Id; path: string }

export interface PhotoState {
  /** The upload made for a file with this content, if any. */
  get(sha256: string): StoredUpload | null
  put(sha256: string, upload: StoredUpload & { intakeId: Id; lineId: Id; path: string }): void
  /** File path -> the line it was last attached to. */
  usedPaths(): Map<string, { intakeId: Id; lineId: Id }>
}

const FILE = 'mcp-photos.json'

/** Remembers uploads by content hash in `<stateDir>/mcp-photos.json` (written whole, via a temporary file and a rename),
 *  so the same file is never uploaded twice, also after a restart. A missing or unreadable file is an empty state. */
export function createPhotoState(stateDir: string): PhotoState {
  const file = path.join(stateDir, FILE)
  let entries: Record<string, Entry> = {}
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) entries = parsed as Record<string, Entry>
  } catch {
    entries = {}
  }
  return {
    get: (sha256) => {
      const e = entries[sha256]
      if (!e) return null
      const { provider, fileId, url, urls, deleteHandle, width, height } = e
      return { provider, fileId, url, urls, deleteHandle, width, height }
    },
    put(sha256, upload) {
      entries = { ...entries, [sha256]: upload }
      mkdirSync(stateDir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(entries, null, 2))
      renameSync(tmp, file)
    },
    usedPaths: () => new Map(Object.values(entries).map((e) => [e.path, { intakeId: e.intakeId, lineId: e.lineId }])),
  }
}
