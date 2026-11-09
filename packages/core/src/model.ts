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
export interface Variant extends Audited, Archivable {
  id: Id
  itemId: Id
  name: string
  description: string | null
  position: number
}
export interface Tag extends Audited {
  id: Id
  inventoryId: Id
  name: string
}
export interface Attribute extends Audited {
  id: Id
  inventoryId: Id
  name: string
  kind: 'text' | 'enum'
  options: string[]
}
export interface CustomUnit extends Audited {
  id: Id
  inventoryId: Id
  name: string
  symbol: string
  prefixPowers: number[]
}
export interface ItemAttribute {
  itemId: Id
  attributeId: Id
  value: string | null
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
  position: number
  createdAt: string
  createdBy: string
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
}
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
