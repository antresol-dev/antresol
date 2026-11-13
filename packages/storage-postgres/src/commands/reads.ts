import type { Command, Id, SnapshotPatch } from '@antresol/core'
import { snapshotSql } from '../queries'
import * as rows from '../rows'
import { sql, type Statement } from '../sql'

type Rows = Record<string, unknown>[]

/** What `apply` reads back in the write's own transaction: the rows the command touched. */
export interface AffectedReads {
  /** Run after the revision lock and BEFORE the command: remembers the item and inventory of a row the command is
   *  about to delete, when nothing would name them afterwards. Usually empty. */
  before: Statement[]
  /** Run after the command and the revision bump. */
  statements: Statement[]
  /** The patch from the rows of `statements`, in order. Null when the command's inventory cannot be named any more (its
   *  target was already gone, e.g. deleted on another device): the caller reloads, as after a wide command. */
  toPatch(rows: Rows[]): SnapshotPatch | null
}

/** Small tables, re-read whole when a command touches them. */
type Table = 'inventory' | 'folders' | 'tags' | 'attributes' | 'units'

const TABLES: Record<Table, { read: (inventoryId: Statement) => Statement; put: (p: SnapshotPatch, r: Rows) => void }> = {
  inventory: {
    read: snapshotSql.inventory,
    put(p, r) {
      if (r[0]) p.inventory = rows.toInventory(r[0])
    },
  },
  folders: {
    read: snapshotSql.folders,
    put(p, r) {
      p.folders = r.map(rows.toFolder)
    },
  },
  tags: {
    read: snapshotSql.tags,
    put(p, r) {
      p.tags = r.map(rows.toTag)
    },
  },
  attributes: {
    read: snapshotSql.attributes,
    put(p, r) {
      p.attributes = r.map(rows.toAttribute)
    },
  },
  units: {
    read: snapshotSql.units,
    put(p, r) {
      p.units = r.map(rows.toCustomUnit)
    },
  },
}

/** An id from the command, as an SQL expression. */
const id = (value: Id): Statement => sql`${value}::uuid`

/** The item and inventory that `rememberedItemSlice` stores, before the command, in transaction-local settings
 *  (`set_config(..., true)`). Null when nothing was stored: a setting never set in the session reads null, one that an
 *  earlier transaction set reads '' after its end. */
const REMEMBERED_ITEM: Statement = { text: `nullif(current_setting('antresol.item_id', true), '')::uuid`, params: [] }
const REMEMBERED_INVENTORY: Statement = { text: `nullif(current_setting('antresol.inventory_id', true), '')::uuid`, params: [] }

const itemOfVariant = (variantId: Id): Statement => sql`(select item_id from variants where id = ${variantId}::uuid)`
const inventoryOfItem = (item: Statement): Statement => sql`(select inventory_id from items where id = ${item})`

/** The slices of the items `where` selects (a condition on the item, aliased `i`; `stock` the same on `movements`): the
 *  snapshot's per-item queries, filtered. Same order as `toPatch` reads them. */
function sliceStatements(where: Statement, stock: Statement): Statement[] {
  return [
    snapshotSql.items(where),
    snapshotSql.variants(where),
    snapshotSql.itemAttributes(where),
    snapshotSql.variantAttributeValues(where),
    snapshotSql.photos(where),
    snapshotSql.stock(stock),
  ]
}

/**
 * The reads for one command: a header, then the slice of its item or items (when there are any), then each touched
 * small table whole. `item`: an expression for one item's id; `items`: one for a uuid[] of ids (not both). The header
 * takes the inventory id from `inventories`, so a command whose inventory or target is gone gets no header row and no
 * patch.
 */
function reads(scope: {
  inventory: Statement
  item?: Statement
  items?: Statement
  tables?: Table[]
  before?: Statement[]
}): AffectedReads {
  const { inventory, tables = [], before = [] } = scope
  const ids = scope.items
    ? sql`array(select distinct x::text from unnest(${scope.items}) as x)`
    : scope.item
      ? sql`array[${scope.item}::text]`
      : sql`array[]::text[]`
  const head = sql`select ${ids} as item_ids, id::text as inventory_id from inventories where id = ${inventory}`
  const slice = scope.items
    ? sliceStatements(sql`i.id = any(${scope.items})`, sql`item_id = any(${scope.items})`)
    : scope.item
      ? sliceStatements(sql`i.id = ${scope.item}`, sql`item_id = ${scope.item}`)
      : []
  return {
    before,
    statements: [head, ...slice, ...tables.map((t) => TABLES[t].read(inventory))],
    toPatch([headRows = [], ...rest]) {
      const h = headRows[0]
      if (!h) return null
      const [items = [], variants = [], itemAttributes = [], variantAttributeValues = [], photos = [], stock = []] =
        rest.slice(0, slice.length)
      const patch: SnapshotPatch = {
        inventoryId: h.inventory_id as Id,
        itemIds: (h.item_ids as Id[] | null) ?? [],
        items: items.map(rows.toItem),
        variants: variants.map(rows.toVariant),
        itemAttributes: itemAttributes.map(rows.toItemAttribute),
        variantAttributeValues: variantAttributeValues.map(rows.toVariantAttributeValue),
        photos: photos.map(rows.toPhoto),
        stock: stock.map(rows.toStockLine),
      }
      tables.forEach((t, i) => TABLES[t].put(patch, rest[slice.length + i] ?? []))
      return patch
    },
  }
}

/** The item's slice; its inventory is read from the item after the command (it still exists, unless it is gone). */
const itemSlice = (item: Statement, inventory: Statement = inventoryOfItem(item)): AffectedReads =>
  reads({ item, inventory })

/** The slice of an item the command may delete, or whose row naming it the command deletes: the item and its inventory
 *  are remembered before the command runs, then read back from the settings. */
function rememberedItemSlice(item: Statement): AffectedReads {
  return reads({
    before: [
      sql`select set_config('antresol.item_id', id::text, true), set_config('antresol.inventory_id', inventory_id::text, true)
          from items where id = ${item}`,
    ],
    item: REMEMBERED_ITEM,
    inventory: REMEMBERED_INVENTORY,
  })
}

const ALL_TABLES = Object.keys(TABLES) as Table[]

/** The items intake.commit touches, as a uuid[]: its new items, the items of its receipts and photos, and those of the
 *  variants it brings back from the archive. */
function intakeItems(c: Extract<Command, { type: 'intake.commit' }>): Statement {
  const named = [...new Set([...c.newItems.map((n) => n.id), ...c.receipts.map((r) => r.itemId), ...c.photos.map((p) => p.itemId)])]
  return sql`(${named}::uuid[] || array(select item_id from variants where id = any(${c.unarchiveVariants}::uuid[])))`
}

/**
 * What a command touched, read in the write's transaction after it. Null for the wide commands (cascades over many
 * items, or a subtree of folders): the caller reloads the inventory instead.
 */
export function affectedReads(c: Command): AffectedReads | null {
  switch (c.type) {
    case 'inventory.create':
    case 'inventory.update':
      return reads({ inventory: id(c.id), tables: ['inventory'] })
    case 'folder.create':
      return reads({ inventory: id(c.inventoryId), tables: ['folders'] })
    case 'folder.update':
    case 'folder.move':
      return reads({ inventory: sql`(select inventory_id from folders where id = ${c.id}::uuid)`, tables: ['folders'] })
    case 'tag.create':
      return reads({ inventory: id(c.inventoryId), tables: ['tags'] })
    case 'tag.rename':
      return reads({ inventory: sql`(select inventory_id from tags where id = ${c.id}::uuid)`, tables: ['tags'] })
    case 'attribute.create':
      return reads({ inventory: id(c.inventoryId), tables: ['attributes'] })
    case 'attribute.update':
      return reads({ inventory: sql`(select inventory_id from attributes where id = ${c.id}::uuid)`, tables: ['attributes'] })
    case 'unit.create':
      return reads({ inventory: id(c.inventoryId), tables: ['units'] })
    case 'unit.update':
      return reads({ inventory: sql`(select inventory_id from custom_units where id = ${c.id}::uuid)`, tables: ['units'] })
    case 'item.create':
      return itemSlice(id(c.id), id(c.inventoryId))
    case 'item.update':
      return itemSlice(id(c.id))
    case 'item.setAttribute':
    case 'item.removeAttribute':
    case 'item.addAxis':
    case 'item.removeAxis':
    case 'item.reorderAxes':
    case 'variant.createMany':
    case 'variant.setValues':
    case 'stock.receive':
    case 'stock.use':
    case 'stock.return':
    case 'stock.set':
    case 'stock.transfer':
    case 'photo.add':
    case 'photo.replace':
    case 'photo.reorder':
      return itemSlice(id(c.itemId))
    case 'variant.update':
      return itemSlice(itemOfVariant(c.id))
    case 'variant.setAttribute':
      return itemSlice(itemOfVariant(c.variantId))
    case 'photo.remove':
      return rememberedItemSlice(sql`(select item_id from photos where id = ${c.id}::uuid)`)
    case 'archive':
      if (c.target === 'inventory') return reads({ inventory: id(c.id), tables: ['inventory'] })
      if (c.target === 'item') return itemSlice(id(c.id))
      if (c.target === 'variant') return itemSlice(itemOfVariant(c.id))
      return null // a folder: its whole subtree of folders and items
    case 'deletePermanently':
      if (c.target === 'item') return rememberedItemSlice(id(c.id))
      if (c.target === 'variant') return rememberedItemSlice(itemOfVariant(c.id))
      return null // an inventory or a folder: everything under it
    case 'intake.commit':
      return reads({ inventory: id(c.inventoryId), items: intakeItems(c), tables: ALL_TABLES })
    case 'restore':
    case 'tag.delete':
    case 'attribute.delete':
    case 'unit.delete':
      return null
  }
}
