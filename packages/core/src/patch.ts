import type { Id } from './ids'
import type {
  Attribute,
  CustomUnit,
  Folder,
  Inventory,
  InventorySnapshot,
  Item,
  ItemAttribute,
  Photo,
  StockLine,
  Tag,
  Variant,
  VariantAttributeValue,
} from './model'

export interface SnapshotPatch {
  inventoryId: Id
  /** Items whose slice is replaced whole: the item row (with tagIds), its variants, item attributes, attribute values
   *  of its variants, photos and stock lines. An id listed here without a row in `items` is removed with its slice. */
  itemIds: Id[]
  items: Item[]
  variants: Variant[]
  itemAttributes: ItemAttribute[]
  variantAttributeValues: VariantAttributeValue[]
  photos: Photo[]
  stock: StockLine[]
  /** Re-read whole when the command touched it; absent means unchanged. */
  inventory?: Inventory
  folders?: Folder[]
  tags?: Tag[]
  attributes?: Attribute[]
  units?: CustomUnit[]
}

/** A new snapshot object (views cache indexes by object identity); the input is not mutated. Throws when
 *  `p.inventoryId !== s.inventory.id`. */
export function patchSnapshot(s: InventorySnapshot, p: SnapshotPatch): InventorySnapshot {
  if (p.inventoryId !== s.inventory.id) {
    throw new Error(`Patch is for inventory ${p.inventoryId}, not ${s.inventory.id}`)
  }
  const touched = new Set(p.itemIds)
  const oldVariantIds = new Set(s.variants.filter((v) => touched.has(v.itemId)).map((v) => v.id))
  return {
    inventory: p.inventory ?? s.inventory,
    folders: p.folders ?? s.folders,
    items: [...s.items.filter((i) => !touched.has(i.id)), ...p.items],
    variants: [...s.variants.filter((v) => !touched.has(v.itemId)), ...p.variants],
    tags: p.tags ?? s.tags,
    attributes: p.attributes ?? s.attributes,
    units: p.units ?? s.units,
    itemAttributes: [...s.itemAttributes.filter((r) => !touched.has(r.itemId)), ...p.itemAttributes],
    variantAttributeValues: [
      ...s.variantAttributeValues.filter((r) => !oldVariantIds.has(r.variantId)),
      ...p.variantAttributeValues,
    ],
    photos: [...s.photos.filter((r) => !touched.has(r.itemId)), ...p.photos],
    stock: [...s.stock.filter((r) => !touched.has(r.itemId)), ...p.stock],
  }
}
