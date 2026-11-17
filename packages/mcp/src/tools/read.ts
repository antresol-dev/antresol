import {
  BUILTIN_UNITS,
  bucketStock,
  customUnitKey,
  formatAttributeValue,
  itemArchived,
  itemAxes,
  itemStock,
  itemsInFolder,
  type Folder,
  type Id,
  type InventorySnapshot,
  type Variant,
  variantLabel,
} from '@antresol/core'
import { priceText, searchRows, snapshotSearch } from '@antresol/kit'
import { activeInventories, requireSource, requireStorage, resolveInventory, type ToolContext } from '../context'
import { ToolError } from '../errors'
import { amountText, folderPath, intakeView, unitSymbol } from '../shape'

export const SEARCH_DEFAULT_LIMIT = 20
export const SEARCH_MAX_LIMIT = 50
export const FOLDER_ITEMS_LIMIT = 200
export const RECEIPTS_LIMIT = 5
export const INTAKES_LIMIT = 50

const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })

const activeFolders = (s: InventorySnapshot): Folder[] => s.folders.filter((f) => folderPath(s, f.id) !== '')
const activeItems = (s: InventorySnapshot, folderId: Id | null) => itemsInFolder(s, folderId)

/** Inventories, then folders, attributes, tags and units of the inventory asked for (or the only one). */
export async function getOverview(ctx: ToolContext, args: { inventory?: string }) {
  const inventories = (await activeInventories(ctx)).map((i) => ({ id: i.id, name: i.name, currency: i.currency }))
  if (!args.inventory && inventories.length > 1) {
    return { inventories, note: 'There are several inventories: call get_overview again with "inventory" (id or name) for folders, attributes, tags and units.' }
  }
  const { inventory, snapshot: s } = await resolveInventory(ctx, args.inventory)
  const folders = activeFolders(s)
    .map((f) => ({ id: f.id, path: folderPath(s, f.id), items: activeItems(s, f.id).length }))
    .sort(byPath)
  return {
    inventories,
    inventory: { id: inventory.id, name: inventory.name, currency: inventory.currency },
    rootItems: activeItems(s, null).length,
    folders,
    attributes: s.attributes.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind === 'enum' ? 'list' : a.kind,
      unit: a.unit,
      siPrefixes: a.kind === 'number' && a.siPrefixes,
      options: a.options,
    })),
    tags: s.tags.map((t) => ({ id: t.id, name: t.name })),
    units: {
      builtin: Object.values(BUILTIN_UNITS).map((u) => ({ key: u.key, symbol: u.symbol, name: u.name })),
      custom: s.units.map((u) => ({ key: customUnitKey(u.id), symbol: u.symbol, name: u.name })),
    },
    photos: { store: ctx.files?.provider ?? null, folder: ctx.config.photosDir },
  }
}

export async function search(ctx: ToolContext, args: { query: string; inventory?: string; limit?: number }) {
  const { snapshot: s } = await resolveInventory(ctx, args.inventory)
  const limit = Math.min(Math.max(Math.trunc(args.limit ?? SEARCH_DEFAULT_LIMIT) || SEARCH_DEFAULT_LIMIT, 1), SEARCH_MAX_LIMIT)
  const rows = searchRows(s, snapshotSearch(s).search(args.query, limit))
  const items = new Map(s.items.map((i) => [i.id, i]))
  return {
    results: rows.map((r) => ({
      itemId: r.itemId,
      variantId: r.variantId,
      name: r.name,
      variant: r.variantName,
      folder: folderPath(s, items.get(r.itemId)?.folderId ?? null),
      stock: r.amount,
      outOfStock: r.outOfStock,
      hasVariants: r.hasVariants,
    })),
  }
}

function variantValues(s: InventorySnapshot, v: Variant) {
  return itemAxes(s, v.itemId).map((a) => {
    const value = s.variantAttributeValues.find((x) => x.variantId === v.id && x.attributeId === a.id)?.value ?? null
    return { attribute: a.name, value: value === null || value === '' ? null : formatAttributeValue(a, value) }
  })
}

/** The inventory an item id belongs to, looked up across the active inventories. */
async function findItem(ctx: ToolContext, itemId: string) {
  const source = requireSource(ctx)
  for (const inventory of await activeInventories(ctx)) {
    const s = await source.snapshot(inventory.id)
    const item = s.items.find((i) => i.id === itemId)
    if (item) return { s, item }
  }
  throw new ToolError(`No item with id "${itemId}". Find ids with search or get_folder.`)
}

export async function getItem(ctx: ToolContext, args: { item: string }) {
  const { s, item } = await findItem(ctx, args.item.trim())
  const currency = s.inventory.currency
  const variants = s.variants.filter((v) => v.itemId === item.id && v.archivedAt === null)
  const loose = bucketStock(s, item.id, null).quantity
  const movements = await requireStorage(ctx).loadMovements(item.id)
  const labels = new Map(s.variants.map((v) => [v.id, variantLabel(s, v)]))
  const receipts = movements
    .filter((m) => m.kind === 'receipt')
    .slice(0, RECEIPTS_LIMIT)
    .map((m) => ({
      at: m.createdAt,
      variant: m.variantId === null ? null : (labels.get(m.variantId) ?? null),
      amount: amountText(s, m.quantity, item.unitKey),
      price: m.totalPrice === null ? null : priceText(m.totalPrice, currency),
      url: m.sourceUrl,
      intakeId: m.intakeId,
    }))
  return {
    id: item.id,
    inventory: s.inventory.name,
    name: item.name,
    description: item.description,
    folder: folderPath(s, item.folderId),
    archived: itemArchived(s, item),
    unit: unitSymbol(s, item.unitKey),
    tags: item.tagIds.map((id) => s.tags.find((t) => t.id === id)?.name).filter((t): t is string => t !== undefined),
    stock: amountText(s, itemStock(s, item.id).quantity, item.unitKey),
    attributes: s.itemAttributes
      .filter((r) => r.itemId === item.id && r.axisPosition === null)
      .flatMap((r) => {
        const a = s.attributes.find((x) => x.id === r.attributeId)
        return a ? [{ name: a.name, value: r.value === null || r.value === '' ? null : formatAttributeValue(a, r.value) }] : []
      }),
    axes: itemAxes(s, item.id).map((a) => a.name),
    variants: variants.map((v) => ({
      id: v.id,
      label: variantLabel(s, v),
      values: variantValues(s, v),
      stock: amountText(s, bucketStock(s, item.id, v.id).quantity, item.unitKey),
    })),
    ...(variants.length > 0 && loose !== '0' ? { stockWithoutVariant: amountText(s, loose, item.unitKey) } : {}),
    photos: s.photos.filter((p) => p.itemId === item.id).map((p) => ({ variantId: p.variantId, url: p.url })),
    receipts,
  }
}

/** A folder by id or by its path "A/B" (names, no case); '' is the root. Null when there is none. */
function findFolder(s: InventorySnapshot, ref: string): { id: Id | null } | null {
  const text = ref.trim()
  if (text === '' || text === '/') return { id: null }
  const byId = s.folders.find((f) => f.id === text)
  if (byId) return folderPath(s, byId.id) === '' ? null : { id: byId.id }
  let parent: Id | null = null
  for (const part of text.split('/').map((p) => p.trim()).filter((p) => p !== '')) {
    const key = part.toLowerCase()
    const next: Folder | undefined = s.folders.find((f) => f.archivedAt === null && f.parentId === parent && f.name.trim().toLowerCase() === key)
    if (!next) return null
    parent = next.id
  }
  return { id: parent }
}

export async function getFolder(ctx: ToolContext, args: { folder: string; inventory?: string }) {
  const { snapshot: s } = await resolveInventory(ctx, args.inventory)
  const found = findFolder(s, args.folder)
  if (!found) throw new ToolError(`No folder "${args.folder}". Use a folder id or a path like "Passives/Resistors" (see get_overview); '' is the root.`)
  const rows = activeItems(s, found.id)
  const folders = s.folders
    .filter((f) => f.archivedAt === null && f.parentId === found.id)
    .map((f) => ({ id: f.id, path: folderPath(s, f.id), items: activeItems(s, f.id).length }))
    .sort(byPath)
  return {
    folder: { id: found.id, path: found.id === null ? '' : folderPath(s, found.id) },
    folders,
    items: rows.slice(0, FOLDER_ITEMS_LIMIT).map((i) => ({
      id: i.id,
      name: i.name,
      stock: amountText(s, itemStock(s, i.id).quantity, i.unitKey),
      variants: s.variants.filter((v) => v.itemId === i.id && v.archivedAt === null).length,
    })),
    more: rows.length > FOLDER_ITEMS_LIMIT,
  }
}

export async function listIntakes(ctx: ToolContext, args: { inventory?: string; query?: string; status?: 'draft' | 'committed' }) {
  const { inventory, snapshot: s } = await resolveInventory(ctx, args.inventory)
  const query = args.query?.trim().toLowerCase()
  const all = (await requireSource(ctx).intakes(inventory.id)).filter((i) => !args.status || i.status === args.status)
  const found = all.filter(
    (i) => !query || [i.id, i.header.shop, i.header.orderNumber, i.header.note, i.header.purchasedOn].some((t) => t?.toLowerCase().includes(query)),
  )
  return {
    inventory: s.inventory.name,
    intakes: found.slice(0, INTAKES_LIMIT).map((i) => ({
      id: i.id,
      status: i.status,
      shop: i.header.shop,
      orderNumber: i.header.orderNumber,
      purchasedOn: i.header.purchasedOn,
      note: i.header.note,
      lines: (i.draft?.lines ?? i.lines ?? []).length,
      updatedAt: i.updatedAt,
      updatedBy: i.updatedBy,
    })),
    more: found.length > INTAKES_LIMIT,
  }
}

export async function getIntake(ctx: ToolContext, args: { intake: string }) {
  const source = requireSource(ctx)
  const id = args.intake.trim()
  for (const inventory of await activeInventories(ctx)) {
    const intake = (await source.intakes(inventory.id)).find((i) => i.id === id)
    if (intake) return intakeView(await source.snapshot(inventory.id), intake)
  }
  throw new ToolError(`No intake with id "${id}". Find ids with list_intakes.`)
}

export async function refresh(ctx: ToolContext) {
  requireSource(ctx).refresh()
  return { refreshed: true }
}
