import type { Id } from './ids'
import type { Quantity } from './quantity'

export interface Audited {
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
}
export interface Archivable {
  archivedAt: string | null
  archiveId: Id | null
}
export interface Inventory extends Audited, Archivable {
  id: Id
  name: string
  description: string | null
  currency: string
}
export interface Folder extends Audited, Archivable {
  id: Id
  inventoryId: Id
  parentId: Id | null
  name: string
  description: string | null
}
export interface Item extends Audited, Archivable {
  id: Id
  inventoryId: Id
  folderId: Id | null
  name: string
  description: string | null
  unitKey: string
  tagIds: Id[]
}
/** A variant has no name: it is told apart by its values on the item's axes (see variants.ts). */
export interface Variant extends Audited, Archivable {
  id: Id
  itemId: Id
  description: string | null
  /** Creation order; variants sort by their axis values, not by this. */
  position: number
}
export interface Tag extends Audited {
  id: Id
  inventoryId: Id
  name: string
}
export type AttributeKind = 'text' | 'enum' | 'number'
export interface Attribute extends Audited {
  id: Id
  inventoryId: Id
  name: string
  kind: AttributeKind
  /** List values, in display and sort order; empty for other kinds. */
  options: string[]
  /** Number kind: free-text unit shown after the value, may be empty; empty for other kinds. */
  unit: string
  /** Number kind: values are entered and shown with SI prefixes. */
  siPrefixes: boolean
  /** "Show in lists": the value shows as a chip in list rows, the palette and the item header. At most
   *  MAX_PINNED_ATTRIBUTES per inventory. */
  pinned: boolean
}
export interface CustomUnit extends Audited {
  id: Id
  inventoryId: Id
  name: string
  symbol: string
  prefixPowers: number[]
}
/** An attribute attached to an item. Shared: `axisPosition` is null and `value` is the item's value (may be empty).
 *  Variant axis: `axisPosition` orders the axes and `value` is always null; each variant holds its own value. */
export interface ItemAttribute {
  itemId: Id
  attributeId: Id
  value: string | null
  axisPosition: number | null
}
export interface VariantAttributeValue {
  variantId: Id
  attributeId: Id
  value: string | null
}
export interface Photo {
  id: Id
  itemId: Id
  variantId: Id | null
  provider: string
  fileId: string
  url: string
  /** Other sizes of the picture the store made; null: none, `url` is all there is. */
  urls: Rendition[] | null
  width: number | null
  height: number | null
  /** What the store needs to delete the file (ImgBB: a delete URL); null: none. */
  deleteHandle: string | null
  position: number
  createdAt: string
  createdBy: string
}
export const RENDITION_FITS = ['inside', 'cover'] as const
export const MAX_RENDITIONS = 8
/** One stored size of a photo: `inside` fits the picture into the box, `cover` fills it (cropped). */
export interface Rendition {
  url: string
  role: string
  width: number
  height: number
  fit: (typeof RENDITION_FITS)[number]
  type: string | null
}
export type MovementKind = 'receipt' | 'usage' | 'return' | 'adjustment' | 'transfer'
export interface Movement {
  id: Id
  seq: number
  itemId: Id
  variantId: Id | null
  kind: MovementKind
  quantity: Quantity
  totalPrice: number | null
  sourceUrl: string | null
  note: string | null
  transferId: Id | null
  createdAt: string
  createdBy: string
}
export interface StockLine {
  itemId: Id
  variantId: Id | null
  quantity: Quantity
  pricedQuantity: Quantity
  pricedTotal: number
  lastPriced: { totalPrice: number; quantity: Quantity; at: string } | null
  /** Time of the bucket's last `adjustment` (a recount), if any. */
  lastCountedAt: string | null
}
/** Snapshots are immutable: changes build new arrays (patchSnapshot does), because variants.ts caches lookups per array. */
export interface InventorySnapshot {
  inventory: Inventory
  folders: Folder[]
  items: Item[]
  variants: Variant[]
  tags: Tag[]
  attributes: Attribute[]
  units: CustomUnit[]
  itemAttributes: ItemAttribute[]
  variantAttributeValues: VariantAttributeValue[]
  photos: Photo[]
  stock: StockLine[]
}
