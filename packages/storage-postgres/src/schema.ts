// Drizzle is used ONLY to describe the schema and generate migrations (drizzle-kit).
// Runtime queries are hand-written SQL via the `sql` tag.
import { sql } from 'drizzle-orm'
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const createdBy = () => text('created_by').notNull()

const audit = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: createdBy(),
  updatedBy: text('updated_by').notNull(),
})

const archive = () => ({
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  archiveId: uuid('archive_id'),
})

export const inventories = pgTable(
  'inventories',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    currency: char('currency', { length: 3 }).notNull(),
    ...audit(),
    ...archive(),
  },
  (t) => [index('inventories_archive_id_idx').on(t.archiveId)],
)

export const folders = pgTable(
  'folders',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    ...audit(),
    ...archive(),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'folders_parent_id_folders_id_fk' }),
    index('folders_inventory_id_idx').on(t.inventoryId),
    index('folders_parent_id_idx').on(t.parentId),
    index('folders_archive_id_idx').on(t.archiveId),
  ],
)

export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ...audit(),
  },
  (t) => [index('tags_inventory_id_idx').on(t.inventoryId)],
)

export const attributes = pgTable(
  'attributes',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    options: text('options').array().notNull().default(sql`'{}'`),
    ...audit(),
  },
  (t) => [
    check('attributes_kind_check', sql`${t.kind} in ('text', 'enum')`),
    index('attributes_inventory_id_idx').on(t.inventoryId),
  ],
)

export const customUnits = pgTable(
  'custom_units',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    symbol: text('symbol').notNull(),
    prefixPowers: smallint('prefix_powers').array().notNull().default(sql`'{}'`),
    ...audit(),
  },
  (t) => [index('custom_units_inventory_id_idx').on(t.inventoryId)],
)

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id),
    name: text('name').notNull(),
    description: text('description'),
    unitKey: text('unit_key').notNull().default('pcs'),
    ...audit(),
    ...archive(),
  },
  (t) => [
    index('items_inventory_id_idx').on(t.inventoryId),
    index('items_folder_id_idx').on(t.folderId),
    index('items_archive_id_idx').on(t.archiveId),
  ],
)

export const itemTags = pgTable(
  'item_tags',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.tagId] })],
)

export const variants = pgTable(
  'variants',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    position: integer('position').notNull(),
    ...audit(),
    ...archive(),
  },
  (t) => [index('variants_archive_id_idx').on(t.archiveId), index('variants_item_id_idx').on(t.itemId)],
)

export const itemAttributes = pgTable(
  'item_attributes',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: text('value'),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.attributeId] })],
)

export const variantAttributeValues = pgTable(
  'variant_attribute_values',
  {
    variantId: uuid('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    attributeId: uuid('attribute_id')
      .notNull()
      .references(() => attributes.id, { onDelete: 'cascade' }),
    value: text('value'),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.attributeId] })],
)

export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => variants.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    fileId: text('file_id').notNull(),
    url: text('url').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [index('photos_item_id_idx').on(t.itemId)],
)

export const movements = pgTable(
  'movements',
  {
    id: uuid('id').primaryKey(),
    seq: bigint('seq', { mode: 'bigint' }).notNull().generatedAlwaysAsIdentity(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => variants.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 6 }).notNull(),
    totalPrice: bigint('total_price', { mode: 'bigint' }),
    sourceUrl: text('source_url'),
    note: text('note'),
    transferId: uuid('transfer_id'),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    check('movements_kind_check', sql`${t.kind} in ('receipt', 'usage', 'return', 'adjustment', 'transfer')`),
    index('movements_inventory_id_idx').on(t.inventoryId),
    index('movements_item_variant_idx').on(t.itemId, t.variantId),
    index('movements_variant_id_idx').on(t.variantId),
  ],
)
