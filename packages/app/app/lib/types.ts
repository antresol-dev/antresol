import type { Id } from '@graymatter/core'

export interface InventoryRef {
  sourceId: string
  inventoryId: Id
}

export type SourceKind = 'neon' | 'dev-pglite'

export type PhotoStore = 'uploadcare' | 'cloudinary' | 'imgur'

export interface SourceConfig {
  id: string
  kind: SourceKind
  name: string
  connectionString: string
  /** Which store takes new photos; absent means Uploadcare. Photos already uploaded stay with their own store. */
  photoStore?: PhotoStore
  uploadcarePublicKey: string | null
  /** Delivery base for new uploads, e.g. 'https://abc123.ucarecd.net'. The upload returns only a UUID; null or absent means ucarecdn.com. */
  uploadcareCdnBase?: string | null
  cloudinaryCloudName?: string | null
  cloudinaryUploadPreset?: string | null
  imgurClientId?: string | null
  createdAt: string
}
