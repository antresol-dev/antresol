// Drizzle is used ONLY to describe the schema and generate migrations (drizzle-kit).
// Runtime queries are hand-written SQL via the `sql` tag.
import type { Rendition } from '@antresol/core'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
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
    icon: text('icon'),
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
    color: text('color'),
    ...audit(),
  },
  (t) => [
    index('tags_inventory_id_idx').on(t.inventoryId),
    check('tags_color_check', sql`${t.color} ~ '^#[0-9A-F]{6}$'`),
  ],
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
    unit: text('unit').notNull().default(''),
    siPrefixes: boolean('si_prefixes').notNull().default(false),
    /** "Show in lists"; at most two per inventory (core MAX_PINNED_ATTRIBUTES, kept by attribute.update's SQL). */
    pinned: boolean('pinned').notNull().default(false),
    ...audit(),
  },
  (t) => [
    check('attributes_kind_check', sql`${t.kind} in ('text', 'enum', 'number')`),
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
    icon: text('icon'),
    color: text('color'),
    unitKey: text('unit_key').notNull().default('pcs'),
    ...audit(),
    ...archive(),
  },
  (t) => [
    index('items_inventory_id_idx').on(t.inventoryId),
    index('items_folder_id_idx').on(t.folderId),
    index('items_archive_id_idx').on(t.archiveId),
    check('items_color_check', sql`${t.color} ~ '^#[0-9A-F]{6}$'`),
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
    description: text('description'),
    // Creation order only: variants sort by their axis values (core variants.ts).
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
    axisPosition: integer('axis_position'),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.attributeId] }),
    uniqueIndex('item_attributes_axis_position_idx')
      .on(t.itemId, t.axisPosition)
      .where(sql`${t.axisPosition} is not null`),
  ],
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
    urls: jsonb('urls').$type<Rendition[]>(),
    width: integer('width'),
    height: integer('height'),
    deleteHandle: text('delete_handle'),
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
    /** The intake the receipt came with. No `on delete`: an intake is never deleted once a movement names it (only a
     *  draft is, and a draft has none), and deleting the inventory takes both in one statement. `set null` would be an
     *  UPDATE, which the journal trigger refuses. */
    intakeId: uuid('intake_id').references(() => intakes.id),
    createdAt: createdAt(),
    createdBy: createdBy(),
  },
  (t) => [
    check('movements_kind_check', sql`${t.kind} in ('receipt', 'usage', 'return', 'adjustment', 'transfer')`),
    index('movements_inventory_id_idx').on(t.inventoryId),
    index('movements_item_variant_idx').on(t.itemId, t.variantId),
    index('movements_variant_id_idx').on(t.variantId),
    index('movements_intake_id_idx').on(t.intakeId),
  ],
)

/** An intake (spec 2026-11-13 intakes): a draft (`draft` holds its new items and lines) until committed (`lines` holds
 *  what it wrote). The header columns serve both. `draft_rev` changes on every write of the row. */
export const intakes = pgTable(
  'intakes',
  {
    id: uuid('id').primaryKey(),
    inventoryId: uuid('inventory_id')
      .notNull()
      .references(() => inventories.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    shop: text('shop'),
    orderNumber: text('order_number'),
    /** YYYY-MM-DD. */
    purchasedOn: text('purchased_on').notNull(),
    note: text('note'),
    draft: jsonb('draft'),
    lines: jsonb('lines'),
    draftRev: uuid('draft_rev').notNull(),
    ...audit(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (t) => [
    check('intakes_status_check', sql`${t.status} in ('draft', 'committed')`),
    index('intakes_inventory_id_idx').on(t.inventoryId),
  ],
)
