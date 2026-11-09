import type { Folder, InventorySnapshot, Item, StockLine, Variant } from '../src/model'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'test', updatedBy: 'test' }
const live = { archivedAt: null, archiveId: null }

export function folder(id: string, name: string, parentId: string | null = null, over: Partial<Folder> = {}): Folder {
  return { id, inventoryId: 'inv', parentId, name, description: null, ...audit, ...live, ...over }
}

export function item(id: string, name: string, folderId: string | null = null, over: Partial<Item> = {}): Item {
  return { id, inventoryId: 'inv', folderId, name, description: null, unitKey: 'pcs', tagIds: [], ...audit, ...live, ...over }
}

export function variant(id: string, itemId: string, name: string, over: Partial<Variant> = {}): Variant {
  return { id, itemId, name, description: null, position: 0, ...audit, ...live, ...over }
}

export function stockLine(itemId: string, variantId: string | null, quantity: string, over: Partial<StockLine> = {}): StockLine {
  return { itemId, variantId, quantity, pricedQuantity: '0', pricedTotal: 0, lastPriced: null, ...over }
}

export function makeSnapshot(parts: Partial<InventorySnapshot> = {}): InventorySnapshot {
  return {
    inventory: { id: 'inv', name: 'Home', description: null, currency: 'EUR', ...audit, ...live },
    folders: [],
    items: [],
    variants: [],
    tags: [],
    attributes: [],
    units: [],
    itemAttributes: [],
    variantAttributeValues: [],
    photos: [],
    stock: [],
    ...parts,
  }
}
