import {
  parseQuantity,
  type Attribute,
  type AttributeKind,
  type CustomUnit,
  type Folder,
  type Inventory,
  type Item,
  type ItemAttribute,
  type Movement,
  type MovementKind,
  type Photo,
  type Quantity,
  type StockLine,
  type Tag,
  type Variant,
  type VariantAttributeValue,
} from '@graymatter/core'

// Row types: numeric/bigint columns are selected `::text` in SQL (see queries.ts).
export type Row = Record<string, unknown>

export function toIso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value))
  return date.toISOString()
}

function toIsoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value)
}

export function toQuantity(value: unknown): Quantity {
  const q = parseQuantity(String(value))
  if (q === null) throw new Error(`invalid quantity from database: ${String(value)}`)
  return q
}

function toNumber(value: unknown): number {
  return Number(value)
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function audited(r: Row) {
  return {
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    createdBy: r.created_by as string,
    updatedBy: r.updated_by as string,
  }
}

function archivable(r: Row) {
  return { archivedAt: toIsoOrNull(r.archived_at), archiveId: (r.archive_id as string | null) ?? null }
}

export const toInventory = (r: Row): Inventory => ({
  id: r.id as string,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  currency: r.currency as string,
  ...audited(r),
  ...archivable(r),
})

export const toFolder = (r: Row): Folder => ({
  id: r.id as string,
  inventoryId: r.inventory_id as string,
  parentId: (r.parent_id as string | null) ?? null,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  ...audited(r),
  ...archivable(r),
})

/** `tag_ids` comes from an aggregate over item_tags. */
export const toItem = (r: Row): Item => ({
  id: r.id as string,
  inventoryId: r.inventory_id as string,
  folderId: (r.folder_id as string | null) ?? null,
  name: r.name as string,
  description: (r.description as string | null) ?? null,
  unitKey: r.unit_key as string,
  tagIds: (r.tag_ids as string[] | null) ?? [],
  ...audited(r),
  ...archivable(r),
})

export const toVariant = (r: Row): Variant => ({
  id: r.id as string,
  itemId: r.item_id as string,
  description: (r.description as string | null) ?? null,
  position: toNumber(r.position),
  ...audited(r),
  ...archivable(r),
})

export const toTag = (r: Row): Tag => ({
  id: r.id as string,
  inventoryId: r.inventory_id as string,
  name: r.name as string,
  ...audited(r),
})

export const toAttribute = (r: Row): Attribute => ({
  id: r.id as string,
  inventoryId: r.inventory_id as string,
  name: r.name as string,
  kind: r.kind as AttributeKind,
  options: (r.options as string[] | null) ?? [],
  unit: (r.unit as string | null) ?? '',
  siPrefixes: r.si_prefixes === true,
  pinned: r.pinned === true,
  ...audited(r),
})

export const toCustomUnit = (r: Row): CustomUnit => ({
  id: r.id as string,
  inventoryId: r.inventory_id as string,
  name: r.name as string,
  symbol: r.symbol as string,
  prefixPowers: ((r.prefix_powers as unknown[] | null) ?? []).map(Number),
  ...audited(r),
})

export const toItemAttribute = (r: Row): ItemAttribute => ({
  itemId: r.item_id as string,
  attributeId: r.attribute_id as string,
  value: (r.value as string | null) ?? null,
  axisPosition: toNumberOrNull(r.axis_position),
})

export const toVariantAttributeValue = (r: Row): VariantAttributeValue => ({
  variantId: r.variant_id as string,
  attributeId: r.attribute_id as string,
  value: (r.value as string | null) ?? null,
})

export const toPhoto = (r: Row): Photo => ({
  id: r.id as string,
  itemId: r.item_id as string,
  variantId: (r.variant_id as string | null) ?? null,
  provider: r.provider as string,
  fileId: r.file_id as string,
  url: r.url as string,
  position: toNumber(r.position),
  createdAt: toIso(r.created_at),
  createdBy: r.created_by as string,
})

export const toMovement = (r: Row): Movement => ({
  id: r.id as string,
  seq: toNumber(r.seq),
  itemId: r.item_id as string,
  variantId: (r.variant_id as string | null) ?? null,
  kind: r.kind as MovementKind,
  quantity: toQuantity(r.quantity),
  totalPrice: toNumberOrNull(r.total_price),
  sourceUrl: (r.source_url as string | null) ?? null,
  note: (r.note as string | null) ?? null,
  transferId: (r.transfer_id as string | null) ?? null,
  createdAt: toIso(r.created_at),
  createdBy: r.created_by as string,
})

export const toStockLine = (r: Row): StockLine => ({
  itemId: r.item_id as string,
  variantId: (r.variant_id as string | null) ?? null,
  quantity: toQuantity(r.quantity),
  pricedQuantity: toQuantity(r.priced_quantity),
  pricedTotal: toNumber(r.priced_total),
  lastPriced:
    r.last_total_price === null || r.last_total_price === undefined
      ? null
      : {
          totalPrice: toNumber(r.last_total_price),
          quantity: toQuantity(r.last_quantity),
          at: toIso(r.last_at),
        },
  lastCountedAt: r.last_counted_at === null || r.last_counted_at === undefined ? null : toIso(r.last_counted_at),
})
