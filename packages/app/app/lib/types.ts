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
  createdAt: string
}
