import type { InventorySnapshot, Movement } from '@graymatter/core'

export interface BackupFile {
  format: 'graymatter-backup'
  version: 1
  exportedAt: string
  app: { schemaVersion: number }
  /** Name and type only: never the connection string or any key. */
  source: { name: string; kind: string }
  /** Every inventory of the source, archived ones included; movements oldest first. */
  inventories: { snapshot: InventorySnapshot; movements: Movement[] }[]
}

export function buildBackup(input: Omit<BackupFile, 'format' | 'version'>): BackupFile {
  return {
    format: 'graymatter-backup',
    version: 1,
    exportedAt: input.exportedAt,
    app: { schemaVersion: input.app.schemaVersion },
    // Rebuilt field by field: whatever else the caller's source object carries stays out of the file.
    source: { name: input.source.name, kind: input.source.kind },
    inventories: input.inventories,
  }
}

/** 'graymatter-<slug>-2026-11-11.json' (the date is UTC). */
export function backupFileName(sourceName: string, at: Date): string {
  const slug = sourceName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `graymatter-${slug || 'source'}-${at.toISOString().slice(0, 10)}.json`
}

export const REVOKE_DELAY_MS = 10_000

/** Saves the backup through a temporary link; the object URL is revoked afterwards. */
export function downloadBackup(backup: BackupFile, at: Date): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(backup.source.name, at)
    document.body.append(a)
    a.click()
    a.remove()
  } catch (e) {
    URL.revokeObjectURL(url)
    throw e
  }
  // Safari and some Firefox versions start the download after click() returns: revoke later.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}
