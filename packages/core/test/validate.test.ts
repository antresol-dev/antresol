import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import type { InventorySnapshot } from '../src/model'
import { DomainError, normalizeCommand, splitVariantNames, validateCommand, type DomainErrorCode } from '../src/validate'
import { folder, item, makeSnapshot, stockLine, variant } from './fixtures'

const ARCH = { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'arch' }
const U = (n: string) => `00000000-0000-7000-8000-${n.padStart(12, '0')}`

function snap(): InventorySnapshot {
  return makeSnapshot({
    folders: [folder('F', 'F'), folder('G', 'G', 'F'), folder('AF', 'Archived', null, ARCH), folder('AC', 'Child', 'AF')],
    items: [
      item('i1', 'TL072', 'F'),
      item('i2', 'Old', null, ARCH),
      item('i3', 'In archived folder', 'AF'),
      item('i4', 'Wire', null, { unitKey: 'custom:u1' }),
    ],
    variants: [variant('v1', 'i1', '10k'), variant('v2', 'i1', 'gone', ARCH)],
    tags: [{ id: 't1', inventoryId: 'inv', name: 'Analog', createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
    attributes: [
      { id: 'a1', inventoryId: 'inv', name: 'Package', kind: 'enum', options: ['DIP', 'SOIC'], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' },
    ],
    units: [{ id: 'u1', inventoryId: 'inv', name: 'Roll', symbol: 'roll', prefixPowers: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
    stock: [stockLine('i1', null, '7'), stockLine('i1', 'v1', '2')],
  })
}

function code(c: Command, s: InventorySnapshot | null = snap()): DomainErrorCode | null {
  return validateCommand(normalizeCommand(c), s)?.code ?? null
}

const newItem = (over: Partial<Extract<Command, { type: 'item.create' }>> = {}): Command => ({
  type: 'item.create', id: U('9'), inventoryId: 'inv', folderId: null, name: 'Part', description: null,
  unitKey: 'pcs', tagIds: [], initialReceipt: null, ...over,
})
const receive = (over: Partial<Extract<Command, { type: 'stock.receive' }>> = {}): Command => ({
  type: 'stock.receive', movementId: 'm', itemId: 'i1', variantId: null, quantity: '1', totalPrice: null, sourceUrl: null, note: null, ...over,
})

describe('validateCommand', () => {
  it('DomainError carries a code', () => {
    const e = new DomainError('not_found')
    expect(e).toBeInstanceOf(Error)
    expect(e.code).toBe('not_found')
  })

  it('names', () => {
    expect(code(newItem({ name: '   ' }))).toBe('name_required')
    expect(code(newItem({ name: 'x'.repeat(201) }))).toBe('name_too_long')
    expect(code(newItem({ name: 'x'.repeat(200) }))).toBeNull()
    expect(code(newItem({ name: 'Резистор 🔌' }))).toBeNull()
    expect(code({ type: 'folder.update', id: 'F', name: ' ' })).toBe('name_required')
  })

  it('normalizeCommand trims names, symbols, options; empty description is null', () => {
    const n = normalizeCommand(newItem({ name: '  TL072 ', description: '  ' })) as Extract<Command, { type: 'item.create' }>
    expect(n.name).toBe('TL072')
    expect(n.description).toBeNull()
    const u = normalizeCommand({ type: 'unit.create', id: 'u', inventoryId: 'inv', name: ' A ', symbol: ' x ', prefixPowers: [] })
    expect(u).toMatchObject({ name: 'A', symbol: 'x' })
    const a = normalizeCommand({ type: 'attribute.create', id: 'a', inventoryId: 'inv', name: 'n', kind: 'enum', options: [' a ', 'b '] })
    expect(a).toMatchObject({ options: ['a', 'b'] })
  })

  it('inventory.create works without snapshot and checks currency', () => {
    const c: Command = { type: 'inventory.create', id: 'x', name: 'Home', description: null, currency: 'EUR' }
    expect(code(c, null)).toBeNull()
    expect(code({ ...c, currency: 'XXX' } as Command, null)).toBe('invalid_currency')
    expect(code({ type: 'tag.delete', id: 't1' }, null)).toBe('not_found')
  })

  it('quantities', () => {
    expect(code(receive({ quantity: '0' }))).toBe('invalid_quantity')
    expect(code(receive({ quantity: '-1' }))).toBe('invalid_quantity')
    expect(code(receive({ quantity: 'abc' }))).toBe('invalid_quantity')
    expect(code({ type: 'stock.return', movementId: 'm', itemId: 'i1', variantId: null, quantity: '0', note: null })).toBe('invalid_quantity')
    expect(code(newItem({ initialReceipt: { movementId: 'm', quantity: '0', totalPrice: null, sourceUrl: null } }))).toBe('invalid_quantity')
    expect(code({ type: 'stock.set', movementId: 'm', itemId: 'i1', variantId: null, target: '-1', note: null })).toBe('invalid_quantity')
    expect(code({ type: 'stock.set', movementId: 'm', itemId: 'i1', variantId: null, target: '0', note: null })).toBeNull()
  })

  it('price and url', () => {
    expect(code(receive({ totalPrice: 1.5 }))).toBe('invalid_price')
    expect(code(receive({ totalPrice: -1 }))).toBe('invalid_price')
    expect(code(receive({ totalPrice: 100 }))).toBeNull()
    expect(code(receive({ sourceUrl: 'ftp://x' }))).toBe('invalid_url')
    expect(code(receive({ sourceUrl: 'https://shop.example/p' }))).toBeNull()
  })

  it('insufficient stock', () => {
    expect(code({ type: 'stock.use', movementId: 'm', itemId: 'i1', variantId: 'v1', quantity: '5', note: null })).toBe('insufficient_stock')
    expect(code({ type: 'stock.use', movementId: 'm', itemId: 'i1', variantId: 'v1', quantity: '2', note: null })).toBeNull()
    expect(
      code({ type: 'stock.transfer', transferId: 't', outMovementId: 'o', inMovementId: 'n', itemId: 'i1', fromVariantId: null, toVariantId: 'v1', quantity: '8' }),
    ).toBe('insufficient_stock')
    expect(
      code({ type: 'stock.transfer', transferId: 't', outMovementId: 'o', inMovementId: 'n', itemId: 'i1', fromVariantId: null, toVariantId: 'v1', quantity: '7' }),
    ).toBeNull()
  })

  it('folder cycles', () => {
    expect(code({ type: 'folder.move', id: 'F', parentId: 'G' })).toBe('folder_cycle')
    expect(code({ type: 'folder.move', id: 'F', parentId: 'F' })).toBe('folder_cycle')
    expect(code({ type: 'folder.move', id: 'G', parentId: null })).toBeNull()
  })

  it('not_found', () => {
    expect(code({ type: 'folder.update', id: 'zz', name: 'a' })).toBe('not_found')
    expect(code(newItem({ folderId: 'zz' }))).toBe('not_found')
    expect(code(newItem({ unitKey: 'custom:nope' }))).toBe('not_found')
    expect(code(newItem({ tagIds: ['nope'] }))).toBe('not_found')
    expect(code(receive({ itemId: 'zz' }))).toBe('not_found')
    expect(code(receive({ variantId: 'zz' }))).toBe('not_found')
    expect(code({ type: 'restore', archiveId: 'nope' })).toBe('not_found')
  })

  it('archived', () => {
    expect(code(newItem({ folderId: 'AF' }))).toBe('archived')
    expect(code(newItem({ folderId: 'AC' }))).toBe('archived')
    expect(code({ type: 'folder.create', id: 'n', inventoryId: 'inv', parentId: 'AF', name: 'x', description: null })).toBe('archived')
    expect(code({ type: 'folder.move', id: 'G', parentId: 'AF' })).toBe('archived')
    expect(code({ type: 'item.update', id: 'i2', name: 'x' })).toBe('archived')
    expect(code({ type: 'item.update', id: 'i3', name: 'x' })).toBe('archived')
    expect(code({ type: 'item.update', id: 'i1', folderId: 'AF' })).toBe('archived')
    expect(code({ type: 'folder.update', id: 'AC', name: 'x' })).toBe('archived')
    expect(code(receive({ itemId: 'i2' }))).toBe('archived')
    expect(code({ type: 'variant.update', id: 'v2', name: 'x' })).toBe('archived')
    expect(code({ type: 'restore', archiveId: 'arch' })).toBeNull()
  })

  it('deletePermanently needs an archived target', () => {
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i1' })).toBe('not_archived')
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i3' })).toBe('not_archived')
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i2' })).toBeNull()
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' })).toBeNull()
    expect(code({ type: 'deletePermanently', target: 'item', id: 'zz' })).toBe('not_found')
  })

  it('enum attribute values', () => {
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'a1', value: 'QFN' })).toBe('invalid_option')
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'a1', value: 'DIP' })).toBeNull()
    expect(code({ type: 'variant.setAttribute', variantId: 'v1', attributeId: 'a1', value: 'QFN' })).toBe('invalid_option')
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'zz', value: 'x' })).toBe('not_found')
  })

  it('duplicate names', () => {
    expect(code({ type: 'tag.create', id: 'n', inventoryId: 'inv', name: ' ANALOG ' })).toBe('duplicate_name')
    expect(code({ type: 'tag.rename', id: 't1', name: 'analog' })).toBeNull()
    expect(code({ type: 'variant.createMany', itemId: 'i1', variants: [{ id: 'n', name: '10K' }] })).toBe('duplicate_name')
    expect(code({ type: 'variant.createMany', itemId: 'i1', variants: [{ id: 'n', name: 'a' }, { id: 'o', name: 'A' }] })).toBe('duplicate_name')
    expect(code({ type: 'variant.createMany', itemId: 'i1', variants: [{ id: 'n', name: '1k' }] })).toBeNull()
  })

  it('unit.delete refuses used units, including archived items', () => {
    expect(code({ type: 'unit.delete', id: 'u1' })).toBe('unit_in_use')
    const s = snap()
    s.items = s.items.map((i) => (i.id === 'i4' ? { ...i, ...ARCH } : i))
    expect(code({ type: 'unit.delete', id: 'u1' }, s)).toBe('unit_in_use')
    s.items = s.items.filter((i) => i.id !== 'i4')
    expect(code({ type: 'unit.delete', id: 'u1' }, s)).toBeNull()
  })

  it('unit prefixPowers must be SI prefixes', () => {
    const c = (p: number[]): Command => ({ type: 'unit.create', id: 'u', inventoryId: 'inv', name: 'x', symbol: 'x', prefixPowers: p })
    expect(code(c([3, -3]))).toBeNull()
    expect(code(c([4]))).toBe('invalid_option')
    expect(code(c([1.5]))).toBe('invalid_option')
    expect(code({ type: 'unit.update', id: 'u1', prefixPowers: [5] })).toBe('invalid_option')
  })
})

describe('splitVariantNames', () => {
  it('splits, trims and dedupes case-insensitively', () => {
    expect(splitVariantNames('1k, 10k,\n100k, 10K')).toEqual(['1k', '10k', '100k'])
  })
})
