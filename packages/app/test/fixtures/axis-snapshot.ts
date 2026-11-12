import type { InventorySnapshot, Movement } from '@antresol/core'

const audit = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', createdBy: 'test', updatedBy: 'test' }
const live = { archivedAt: null, archiveId: null }
const attr = (id: string, name: string, kind: 'text' | 'enum' | 'number', over: object = {}) => ({
  id,
  inventoryId: 'inv',
  name,
  kind,
  options: [] as string[],
  unit: '',
  siPrefixes: false,
  ...audit,
  ...over,
})
const variant = (id: string, itemId: string, over: object = {}) => ({ id, itemId, description: null, position: 0, ...audit, ...live, ...over })
const line = (itemId: string, variantId: string | null, quantity: string) => ({
  itemId,
  variantId,
  quantity,
  pricedQuantity: '0',
  pricedTotal: 0,
  lastPriced: null,
})

/**
 * Resistor R: number axis Resistance (Ω, prefixes), shared Package; variants 10k, 1k, 4k7 (archived), all with stock.
 * Capacitor C: axes Capacitance, Voltage; variant c16 has no Voltage. Module M: no axes.
 * Created in the order 10k, 1k so that a sort by position would be wrong.
 */
export function axisSnapshot(): InventorySnapshot {
  return {
    inventory: { id: 'inv', name: 'Home', description: null, currency: 'EUR', ...audit, ...live },
    folders: [],
    items: ['R', 'C', 'M'].map((id) => ({
      id,
      inventoryId: 'inv',
      folderId: null,
      name: id,
      description: null,
      unitKey: 'pcs',
      tagIds: [],
      ...audit,
      ...live,
    })),
    variants: [
      variant('r10k', 'R', { position: 0 }),
      variant('r1k', 'R', { position: 1 }),
      variant('r4k7', 'R', { position: 2, archivedAt: '2026-02-01T00:00:00Z', archiveId: 'arch' }),
      variant('c50', 'C'),
      variant('c16', 'C', { position: 1 }),
    ],
    tags: [],
    attributes: [
      attr('res', 'Resistance', 'number', { unit: 'Ω', siPrefixes: true }),
      attr('cap', 'Capacitance', 'number', { unit: 'F', siPrefixes: true }),
      attr('volt', 'Voltage', 'number', { unit: 'V', siPrefixes: true }),
      attr('pkg', 'Package', 'enum', { options: ['0805', 'THT'] }),
      attr('mark', 'Marking', 'text'),
    ],
    units: [],
    itemAttributes: [
      { itemId: 'R', attributeId: 'res', value: null, axisPosition: 0 },
      { itemId: 'R', attributeId: 'pkg', value: '0805', axisPosition: null },
      { itemId: 'R', attributeId: 'mark', value: '  ', axisPosition: null },
      { itemId: 'C', attributeId: 'cap', value: null, axisPosition: 0 },
      { itemId: 'C', attributeId: 'volt', value: null, axisPosition: 1 },
    ],
    variantAttributeValues: [
      { variantId: 'r10k', attributeId: 'res', value: '10000' },
      { variantId: 'r1k', attributeId: 'res', value: '1000' },
      { variantId: 'r4k7', attributeId: 'res', value: '4700' },
      { variantId: 'c50', attributeId: 'cap', value: '0.0000001' },
      { variantId: 'c50', attributeId: 'volt', value: '50' },
      { variantId: 'c16', attributeId: 'cap', value: '0.0000001' },
    ],
    photos: [],
    stock: [line('R', 'r10k', '5'), line('R', 'r1k', '2'), line('R', 'r4k7', '1'), line('M', null, '3')],
  }
}

export const movement = (id: string, variantId: string | null, over: Partial<Movement> = {}): Movement => ({
  id,
  seq: 1,
  itemId: 'R',
  variantId,
  kind: 'receipt',
  quantity: '1',
  totalPrice: null,
  sourceUrl: null,
  note: null,
  transferId: null,
  createdAt: '2026-03-01T00:00:00Z',
  createdBy: 'test',
  ...over,
})
