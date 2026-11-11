import type {
  Attribute,
  Folder,
  InventorySnapshot,
  Item,
  ItemAttribute,
  StockLine,
  Variant,
  VariantAttributeValue,
} from '../src/model'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'test', updatedBy: 'test' }
const live = { archivedAt: null, archiveId: null }
export const ARCHIVED = { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'arch' }

export function folder(id: string, name: string, parentId: string | null = null, over: Partial<Folder> = {}): Folder {
  return { id, inventoryId: 'inv', parentId, name, description: null, ...audit, ...live, ...over }
}

export function item(id: string, name: string, folderId: string | null = null, over: Partial<Item> = {}): Item {
  return { id, inventoryId: 'inv', folderId, name, description: null, unitKey: 'pcs', tagIds: [], ...audit, ...live, ...over }
}

export function variant(id: string, itemId: string, over: Partial<Variant> = {}): Variant {
  return { id, itemId, description: null, position: 0, ...audit, ...live, ...over }
}

export function attribute(id: string, name: string, kind: Attribute['kind'] = 'text', over: Partial<Attribute> = {}): Attribute {
  return { id, inventoryId: 'inv', name, kind, options: [], unit: '', siPrefixes: false, ...audit, ...over }
}

/** The attribute is a variant axis of the item, at this position. */
export function axis(itemId: string, attributeId: string, axisPosition: number): ItemAttribute {
  return { itemId, attributeId, value: null, axisPosition }
}

/** The attribute is shared: one value for the whole item. */
export function shared(itemId: string, attributeId: string, value: string | null): ItemAttribute {
  return { itemId, attributeId, value, axisPosition: null }
}

export function value(variantId: string, attributeId: string, v: string | null): VariantAttributeValue {
  return { variantId, attributeId, value: v }
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

/**
 * Electronics parts:
 * - resistor R: axis Resistance (Ω, SI prefixes), shared Package; variants 1k, 10k and an archived 4k7;
 * - capacitor C: axes Capacitance (F) and Voltage (V); variants 100n·50V and 100n·16V;
 * - LED L: list axis Color (red, green, blue); variants blue, red, green;
 * - module M: no axes, no variants.
 */
export function electronics(): InventorySnapshot {
  return makeSnapshot({
    items: [item('R', 'Resistor'), item('C', 'Capacitor'), item('L', 'LED'), item('M', 'Module')],
    attributes: [
      attribute('res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }),
      attribute('cap', 'Capacitance', 'number', { unit: 'F', siPrefixes: true }),
      attribute('volt', 'Voltage', 'number', { unit: 'V', siPrefixes: true }),
      attribute('pkg', 'Package', 'enum', { options: ['0805', '0603', 'THT'] }),
      attribute('color', 'Color', 'enum', { options: ['red', 'green', 'blue'] }),
      attribute('mark', 'Marking', 'text'),
    ],
    itemAttributes: [
      axis('R', 'res', 0),
      shared('R', 'pkg', '0805'),
      axis('C', 'volt', 1),
      axis('C', 'cap', 0),
      axis('L', 'color', 0),
    ],
    variants: [
      variant('r1k', 'R'),
      variant('r10k', 'R'),
      variant('r4k7', 'R', ARCHIVED),
      variant('c50', 'C'),
      variant('c16', 'C'),
      variant('lblue', 'L'),
      variant('lred', 'L'),
      variant('lgreen', 'L'),
    ],
    variantAttributeValues: [
      value('r1k', 'res', '1000'),
      value('r10k', 'res', '10000'),
      value('r4k7', 'res', '4700'),
      value('c50', 'cap', '0.0000001'),
      value('c50', 'volt', '50'),
      value('c16', 'cap', '0.0000001'),
      value('c16', 'volt', '16'),
      value('lblue', 'color', 'blue'),
      value('lred', 'color', 'red'),
      value('lgreen', 'color', 'green'),
    ],
  })
}
