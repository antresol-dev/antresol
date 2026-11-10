import type { Id } from '@graymatter/core'

export interface InventoryRef {
  sourceId: string
  inventoryId: Id
}

export type SourceKind = 'neon' | 'dev-pglite'

export interface SourceConfig {
  id: string
  kind: SourceKind
  name: string
  connectionString: string
  uploadcarePublicKey: string | null
  /** Delivery base for new uploads, e.g. 'https://abc123.ucarecd.net'. The upload returns only a UUID; null or absent means ucarecdn.com. */
  uploadcareCdnBase?: string | null
  createdAt: string
}
