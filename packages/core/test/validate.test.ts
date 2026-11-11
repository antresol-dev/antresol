import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import type { InventorySnapshot } from '../src/model'
import { DomainError, MAX_PINNED_ATTRIBUTES, normalizeCommand, validateCommand, type DomainErrorCode } from '../src/validate'
import { attribute, axis, electronics, folder, item, makeSnapshot, shared, stockLine, value, variant } from './fixtures'

const ARCH = { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'arch' }
const U = (n: string) => `00000000-0000-7000-8000-${n.padStart(12, '0')}`

function snap(): InventorySnapshot {
  return makeSnapshot({
    folders: [folder('F', 'F'), folder('G', 'G', 'F'), folder('AF', 'Archived', null, ARCH), folder('AC', 'Child', 'AF', ARCH)],
    items: [
      item('i1', 'TL072', 'F'),
      item('i2', 'Old', null, ARCH),
      item('i3', 'In archived folder', 'AF'),
      item('i4', 'Wire', null, { unitKey: 'custom:u1' }),
    ],
    variants: [variant('v1', 'i1'), variant('v2', 'i1', ARCH)],
    tags: [{ id: 't1', inventoryId: 'inv', name: 'Analog', createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' }],
    attributes: [
      attribute('a1', 'Package', 'enum', { options: ['DIP', 'SOIC'] }),
      attribute('a2', 'Color', 'text'),
    ],
    itemAttributes: [axis('i1', 'a2', 0)],
    variantAttributeValues: [value('v1', 'a2', 'red'), value('v2', 'a2', 'gone')],
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

  it('normalizeCommand trims names, symbols, options, units; empty description is null', () => {
    const n = normalizeCommand(newItem({ name: '  TL072 ', description: '  ' })) as Extract<Command, { type: 'item.create' }>
    expect(n.name).toBe('TL072')
    expect(n.description).toBeNull()
    const u = normalizeCommand({ type: 'unit.create', id: 'u', inventoryId: 'inv', name: ' A ', symbol: ' x ', prefixPowers: [] })
    expect(u).toMatchObject({ name: 'A', symbol: 'x' })
    const a = normalizeCommand({
      type: 'attribute.create', id: 'a', inventoryId: 'inv', name: 'n', kind: 'enum', options: [' a ', 'b '], unit: ' ', siPrefixes: false,
    })
    expect(a).toMatchObject({ options: ['a', 'b'], unit: '' })
    expect(normalizeCommand({ type: 'attribute.update', id: 'a', unit: ' Ω ' })).toMatchObject({ unit: 'Ω' })
    expect(normalizeCommand({ type: 'attribute.update', id: 'a', name: 'x' })).not.toHaveProperty('unit')
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
    expect(code({ type: 'variant.update', id: 'v2', description: 'x' })).toBe('archived')
    expect(code({ type: 'restore', archiveId: 'arch' })).toBeNull()
  })

  it('deletePermanently needs an archived target', () => {
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i1' })).toBe('not_archived')
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i3' })).toBe('not_archived')
    expect(code({ type: 'deletePermanently', target: 'item', id: 'i2' })).toBeNull()
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' })).toBe('not_archived')
    expect(code({ type: 'deletePermanently', target: 'item', id: 'zz' })).toBe('not_found')
  })

  it('enum attribute values', () => {
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'a1', value: 'QFN' })).toBe('invalid_option')
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'a1', value: 'DIP' })).toBeNull()
    expect(code({ type: 'variant.setAttribute', variantId: 'v1', attributeId: 'a1', value: 'DIP' })).toBe('not_an_axis')
    expect(code({ type: 'item.setAttribute', itemId: 'i1', attributeId: 'zz', value: 'x' })).toBe('not_found')
  })

  it('duplicate names', () => {
    expect(code({ type: 'tag.create', id: 'n', inventoryId: 'inv', name: ' ANALOG ' })).toBe('duplicate_name')
    expect(code({ type: 'tag.rename', id: 't1', name: 'analog' })).toBeNull()
  })

  it('tag.create sent again after it landed is a retry, not a duplicate', () => {
    expect(code({ type: 'tag.create', id: 't1', inventoryId: 'inv', name: 'Analog' })).toBeNull()
    expect(code({ type: 'tag.create', id: 't1', inventoryId: 'inv', name: ' analog ' })).toBeNull()
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

describe('final review fixes', () => {
  const photo = (id: string, itemId: string, variantId: string | null = null) => ({
    id, itemId, variantId, provider: 'p', fileId: id, url: 'https://x', position: 0, createdAt: '', createdBy: '',
  })
  const withPhotos = () => ({ ...snap(), photos: [photo('p1', 'i1'), photo('p2', 'i1'), photo('p3', 'i1', 'v1')] })

  it('dedupes tagIds, keeping order', () => {
    const n = normalizeCommand(newItem({ tagIds: ['b', 'a', 'b', 'a'] })) as Extract<Command, { type: 'item.create' }>
    expect(n.tagIds).toEqual(['b', 'a'])
    expect(normalizeCommand({ type: 'item.update', id: 'i1', tagIds: ['t1', 't1'] })).toMatchObject({ tagIds: ['t1'] })
    expect(normalizeCommand({ type: 'item.update', id: 'i1', name: 'x' })).not.toHaveProperty('tagIds')
  })

  it('archiving something already archived is refused', () => {
    expect(code({ type: 'archive', target: 'item', id: 'i2', archiveId: 'n' })).toBe('archived')
    expect(code({ type: 'archive', target: 'item', id: 'i3', archiveId: 'n' })).toBe('archived')
    expect(code({ type: 'archive', target: 'folder', id: 'AC', archiveId: 'n' })).toBe('archived')
    expect(code({ type: 'archive', target: 'variant', id: 'v2', archiveId: 'n' })).toBe('archived')
    expect(code({ type: 'archive', target: 'item', id: 'i1', archiveId: 'n' })).toBeNull()
  })

  it('an archive sent again after it landed (same archiveId) is a retry, not a refusal', () => {
    expect(code({ type: 'archive', target: 'item', id: 'i2', archiveId: 'arch' })).toBeNull()
    expect(code({ type: 'archive', target: 'folder', id: 'AF', archiveId: 'arch' })).toBeNull()
    expect(code({ type: 'archive', target: 'folder', id: 'AC', archiveId: 'arch' })).toBeNull()
    expect(code({ type: 'archive', target: 'variant', id: 'v2', archiveId: 'arch' })).toBeNull()
    // Archived with it through its folder, not by this command: the item carries no archiveId of its own.
    expect(code({ type: 'archive', target: 'item', id: 'i3', archiveId: 'arch' })).toBe('archived')
    const s = snap()
    s.inventory = { ...s.inventory, ...ARCH }
    expect(code({ type: 'archive', target: 'inventory', id: 'inv', archiveId: 'arch' }, s)).toBeNull()
    expect(code({ type: 'archive', target: 'inventory', id: 'inv', archiveId: 'n' }, s)).toBe('archived')
    expect(code({ type: 'archive', target: 'item', id: 'i1', archiveId: 'arch' }, s)).toBe('archived')
  })

  it('quantities and prices must fit the columns', () => {
    expect(code(receive({ quantity: '100000000000000' }))).toBe('invalid_quantity')
    expect(code(receive({ quantity: '99999999999999.999999' }))).toBeNull()
    expect(code({ type: 'stock.set', movementId: 'm', itemId: 'i1', variantId: null, target: '100000000000000', note: null })).toBe('invalid_quantity')
    expect(code(receive({ totalPrice: 1e20 }))).toBe('invalid_price')
    expect(code(receive({ totalPrice: Number.MAX_SAFE_INTEGER }))).toBeNull()
  })

  it('an archived inventory accepts no writes except restore and deletePermanently', () => {
    const s = snap()
    s.inventory = { ...s.inventory, ...ARCH }
    expect(code(receive(), s)).toBe('archived')
    expect(code(newItem(), s)).toBe('archived')
    expect(code({ type: 'tag.create', id: 'n', inventoryId: 'inv', name: 'x' }, s)).toBe('archived')
    expect(code({ type: 'folder.move', id: 'G', parentId: null }, s)).toBe('archived')
    expect(code({ type: 'photo.remove', id: 'p1' }, { ...s, photos: [photo('p1', 'i1')] })).toBe('archived')
    expect(code({ type: 'restore', archiveId: 'arch' }, s)).toBeNull()
    expect(code({ type: 'deletePermanently', target: 'inventory', id: 'inv' }, s)).toBeNull()
  })

  it('photo.reorder must list exactly the item photos', () => {
    const s = withPhotos()
    const reorder = (orderedIds: string[]): Command => ({ type: 'photo.reorder', itemId: 'i1', orderedIds })
    expect(code(reorder(['p2', 'p3', 'p1']), s)).toBeNull()
    expect(code(reorder(['p1', 'p2']), s)).toBe('invalid_option')
    expect(code(reorder(['p1', 'p1', 'p2']), s)).toBe('invalid_option')
    expect(code(reorder(['p1', 'p2', 'p3', 'zz']), s)).toBe('not_found')
  })

  it('a variant may have only one photo', () => {
    const s = withPhotos()
    const add = (variantId: string | null): Command => ({ type: 'photo.add', id: 'n', itemId: 'i1', variantId, provider: 'p', fileId: 'f', url: 'https://x' })
    expect(code(add('v1'), s)).toBe('invalid_option')
    expect(code(add(null), s)).toBeNull()
    expect(code(add('v1'), snap())).toBeNull()
  })

  it('deletePermanently of a folder refuses when anything below is still active', () => {
    const s = snap()
    s.items = s.items.map((i) => (i.id === 'i3' ? { ...i, ...ARCH } : i)) // archived properly with its folder
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' }, s)).toBeNull()
    s.items = [...s.items, item('i5', 'Stale', 'AC')]
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' }, s)).toBe('not_archived')
    s.items = s.items.map((i) => (i.id === 'i5' ? { ...i, ...ARCH } : i))
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' }, s)).toBeNull()
    s.folders = [...s.folders, folder('AG', 'Stale folder', 'AC')]
    expect(code({ type: 'deletePermanently', target: 'folder', id: 'AF' }, s)).toBe('not_archived')
  })
})

describe('quantity canonicalization', () => {
  const use = (q: string): Command => ({ type: 'stock.use', movementId: 'm', itemId: 'i1', variantId: 'v1', quantity: q, note: null })
  const transfer = (q: string): Command => ({
    type: 'stock.transfer', transferId: 't', outMovementId: 'o', inMovementId: 'n', itemId: 'i1', fromVariantId: 'v1', toVariantId: null, quantity: q,
  })
  const raw = (c: Command) => validateCommand(c, snap())?.code ?? null

  it('normalizeCommand canonicalizes quantities', () => {
    expect(normalizeCommand(use(' 1,5 '))).toMatchObject({ quantity: '1.5' })
    expect(normalizeCommand({ type: 'stock.set', movementId: 'm', itemId: 'i1', variantId: null, target: '2,50', note: null })).toMatchObject({ target: '2.5' })
    expect(
      normalizeCommand(newItem({ initialReceipt: { movementId: 'm', quantity: '1,5', totalPrice: null, sourceUrl: null } })),
    ).toMatchObject({ initialReceipt: { quantity: '1.5' } })
    expect(normalizeCommand(use('abc'))).toMatchObject({ quantity: 'abc' })
  })
  it('validateCommand never throws on un-normalized quantities', () => {
    expect(raw(use('1,5'))).toBeNull()
    expect(raw(use('2,5'))).toBe('insufficient_stock')
    expect(raw(transfer('1,5'))).toBeNull()
    expect(raw(transfer('2,5'))).toBe('insufficient_stock')
    for (const q of ['+5', 'abc', '5.']) {
      expect(raw(use(q))).toBe('invalid_quantity')
      expect(raw(transfer(q))).toBe('invalid_quantity')
    }
  })
})


describe('variants by axes', () => {
  const ec = (c: Command, s: InventorySnapshot = electronics()) => code(c, s)
  type Values = { attributeId: string; value: string }[]
  const createMany = (itemId: string, ...rows: Values[]): Command => ({
    type: 'variant.createMany',
    itemId,
    variants: rows.map((values, n) => ({ id: U(String(100 + n)), values })),
  })
  const res = (v: string): Values => [{ attributeId: 'res', value: v }]
  const capVolt = (cap: string, volt: string): Values => [
    { attributeId: 'cap', value: cap },
    { attributeId: 'volt', value: volt },
  ]

  it('createMany refuses a duplicate of an archived variant', () => {
    expect(ec(createMany('R', res('4700')))).toBe('duplicate_variant')
    expect(ec(createMany('R', res('10000')))).toBe('duplicate_variant')
    expect(ec(createMany('R', res('2200'), res('22000')))).toBeNull()
  })
  it('createMany refuses duplicates inside the batch', () => {
    expect(ec(createMany('R', res('2200'), res('2200')))).toBe('duplicate_variant')
    expect(ec(createMany('C', capVolt('0.000001', '16'), capVolt('0.000001', '16')))).toBe('duplicate_variant')
    expect(ec(createMany('C', capVolt('0.000001', '16'), capVolt('0.000001', '25')))).toBeNull()
  })
  it('createMany compares text values without case and outer spaces', () => {
    const e = electronics()
    const s = { ...e, itemAttributes: [...e.itemAttributes, axis('M', 'mark', 0)] }
    const mark = (v: string): Values => [{ attributeId: 'mark', value: v }]
    expect(ec(createMany('M', mark('Red'), mark(' red ')), s)).toBe('duplicate_variant')
    expect(ec(createMany('M', mark('Red'), mark('Blue')), s)).toBeNull()
  })
  it('createMany treats an existing id with the same item and axis values as a retry', () => {
    const s = electronics()
    const retry = (id: string, itemId: string, values: Values) => ({ type: 'variant.createMany', itemId, variants: [{ id, values }] }) as Command
    expect(ec(retry('r1k', 'R', res('1000')), s)).toBeNull()
    expect(ec(retry('r1k', 'R', res('1001')), s)).toBe('invalid_option')
    expect(ec(retry('c50', 'R', res('1000')), s)).toBe('invalid_option')
    expect(ec({ type: 'variant.createMany', itemId: 'R', variants: [{ id: 'r1k', values: res('1000') }, { id: U('100'), values: res('2200') }] } as Command, s)).toBeNull()
  })
  it('createMany refuses duplicate ids in the batch and ids of existing variants', () => {
    const dup: Command = {
      type: 'variant.createMany', itemId: 'R',
      variants: [{ id: U('100'), values: res('2200') }, { id: U('100'), values: res('3300') }],
    }
    expect(ec(dup)).toBe('invalid_option')
    const s = electronics()
    const own = { type: 'variant.createMany', itemId: 'R', variants: [{ id: 'r1k', values: res('2200') }] } as Command
    expect(ec(own, s)).toBe('invalid_option')
    const other = { type: 'variant.createMany', itemId: 'R', variants: [{ id: 'c50', values: res('2200') }] } as Command
    expect(ec(other, s)).toBe('invalid_option')
  })
  it('createMany with a null axis value is axis_value_required, not a crash', () => {
    const nul = [{ attributeId: 'res', value: null as unknown as string }]
    expect(ec(createMany('R', nul))).toBe('axis_value_required')
  })
  it('createMany needs a value on every axis', () => {
    expect(ec(createMany('C', [{ attributeId: 'cap', value: '0.000001' }]))).toBe('axis_value_required')
    expect(ec(createMany('C', capVolt('0.000001', '  ')))).toBe('axis_value_required')
  })
  it('createMany needs an item with axes', () => {
    expect(ec(createMany('M', []))).toBe('axis_required')
    expect(ec({ type: 'variant.createMany', itemId: 'M', variants: [] })).toBe('axis_required')
  })
  it('createMany takes values only for axes, checked by kind', () => {
    expect(ec(createMany('R', [...res('2200'), { attributeId: 'pkg', value: '0805' }]))).toBe('not_an_axis')
    expect(ec(createMany('R', [...res('2200'), { attributeId: 'nope', value: 'x' }]))).toBe('not_found')
    expect(ec(createMany('R', [...res('2200'), { attributeId: 'res', value: '3300' }]))).toBe('invalid_option')
    expect(ec(createMany('R', res('4.7k')))).toBe('invalid_number')
    expect(ec(createMany('L', [{ attributeId: 'color', value: 'pink' }]))).toBe('invalid_option')
    expect(ec(createMany('L', [{ attributeId: 'color', value: 'red' }]))).toBe('duplicate_variant')
  })
  it('createMany on an archived item is refused', () => {
    const s = electronics()
    const archived = { ...s, items: s.items.map((i) => (i.id === 'R' ? { ...i, ...ARCH } : i)) }
    expect(ec(createMany('R', res('2200')), archived)).toBe('archived')
  })

  it('item.setAttribute checks the value by kind', () => {
    const set = (attributeId: string, v: string | null): Command => ({ type: 'item.setAttribute', itemId: 'M', attributeId, value: v })
    expect(ec(set('res', '4.7k'))).toBe('invalid_number')
    expect(ec(set('res', '4700'))).toBeNull()
    expect(ec(set('res', null))).toBeNull()
    expect(ec(set('pkg', 'QFN'))).toBe('invalid_option')
    expect(ec(set('pkg', 'THT'))).toBeNull()
    expect(ec(set('mark', ' 103 '))).toBeNull()
    expect(ec(set('nope', 'x'))).toBe('not_found')
  })
  it('item.setAttribute works only for shared attributes', () => {
    expect(ec({ type: 'item.setAttribute', itemId: 'R', attributeId: 'res', value: '4700' })).toBe('attribute_is_axis')
    expect(ec({ type: 'item.setAttribute', itemId: 'R', attributeId: 'pkg', value: '0603' })).toBeNull()
  })
  it('normalizeCommand trims values; an empty shared or variant value is null', () => {
    expect(normalizeCommand({ type: 'item.setAttribute', itemId: 'M', attributeId: 'mark', value: ' Red ' })).toMatchObject({ value: 'Red' })
    expect(normalizeCommand({ type: 'item.setAttribute', itemId: 'M', attributeId: 'mark', value: '   ' })).toMatchObject({ value: null })
    expect(normalizeCommand({ type: 'variant.setAttribute', variantId: 'r1k', attributeId: 'res', value: ' ' })).toMatchObject({ value: null })
    expect(normalizeCommand(createMany('C', capVolt(' 0.000001 ', ' 16')))).toMatchObject({
      variants: [{ values: [{ attributeId: 'cap', value: '0.000001' }, { attributeId: 'volt', value: '16' }] }],
    })
  })

  it('variant.setAttribute works only for axes and allows an empty value', () => {
    const set = (variantId: string, attributeId: string, v: string | null): Command => ({ type: 'variant.setAttribute', variantId, attributeId, value: v })
    expect(ec(set('r1k', 'pkg', '0805'))).toBe('not_an_axis')
    expect(ec(set('r1k', 'res', '2200'))).toBeNull()
    expect(ec(set('c50', 'volt', null))).toBeNull()
    expect(ec(set('r1k', 'res', '2k2'))).toBe('invalid_number')
    expect(ec(set('lred', 'color', 'pink'))).toBe('invalid_option')
    expect(ec(set('r4k7', 'res', '2200'))).toBe('archived')
  })
  it('variant.setAttribute refuses a change that makes two variants the same', () => {
    const set = (variantId: string, attributeId: string, v: string | null): Command => ({ type: 'variant.setAttribute', variantId, attributeId, value: v })
    expect(ec(set('r1k', 'res', '10000'))).toBe('duplicate_variant')
    expect(ec(set('r1k', 'res', '4700'))).toBe('duplicate_variant')
    expect(ec(set('c16', 'volt', '50'))).toBe('duplicate_variant')
    expect(ec(set('r1k', 'res', '1000'))).toBeNull()
    const s = electronics()
    const oneEmpty = { ...s, variantAttributeValues: s.variantAttributeValues.map((r) => (r.variantId === 'c50' && r.attributeId === 'volt' ? { ...r, value: null } : r)) }
    expect(ec(set('c16', 'volt', null), oneEmpty)).toBe('duplicate_variant')
  })
  it('variant.update changes only the description', () => {
    expect(ec({ type: 'variant.update', id: 'r1k', description: 'metal film' })).toBeNull()
    expect(ec({ type: 'variant.update', id: 'zz', description: 'x' })).toBe('not_found')
  })

  it('item.addAxis is allowed and does nothing for an attribute that is already an axis', () => {
    const add = (itemId: string, attributeId: string): Command => ({ type: 'item.addAxis', itemId, attributeId, firstVariantId: U('200') })
    expect(ec(add('R', 'res'))).toBeNull()
    expect(ec(add('R', 'pkg'))).toBeNull()
    expect(ec(add('R', 'volt'))).toBeNull()
    expect(ec(add('M', 'res'))).toBeNull()
    expect(ec(add('R', 'nope'))).toBe('not_found')
    expect(ec(add('zz', 'res'))).toBe('not_found')
  })
  it('item.addAxis is never rejected for the first-variant cases (storage applies the rule)', () => {
    const add = (itemId: string, attributeId: string): Command => ({ type: 'item.addAxis', itemId, attributeId, firstVariantId: U('200') })
    const e = electronics()
    // No other axis, no variants, shared value: the first variant is expected (storage).
    const none = { ...e, itemAttributes: [...e.itemAttributes, shared('M', 'pkg', '0805')] }
    expect(ec(add('M', 'pkg'), none)).toBeNull()
    // Another axis already present, no variants: only the role changes, no variant.
    const other = { ...none, itemAttributes: [...none.itemAttributes, axis('M', 'mark', 0)] }
    expect(ec(add('M', 'pkg'), other)).toBeNull()
  })
  it('item.removeAxis needs an axis and the remaining axes must tell variants apart', () => {
    const remove = (itemId: string, attributeId: string): Command => ({ type: 'item.removeAxis', itemId, attributeId })
    expect(ec(remove('R', 'pkg'))).toBe('not_an_axis')
    expect(ec(remove('M', 'res'))).toBe('not_an_axis')
    expect(ec(remove('C', 'volt'))).toBe('duplicate_variant')
    expect(ec(remove('C', 'cap'))).toBeNull()
    expect(ec(remove('R', 'res'))).toBe('axis_required')
    expect(ec(remove('zz', 'res'))).toBe('not_found')
  })
  it('item.removeAttribute of an axis follows the axis removal rules', () => {
    const remove = (itemId: string, attributeId: string): Command => ({ type: 'item.removeAttribute', itemId, attributeId })
    expect(ec(remove('C', 'volt'))).toBe('duplicate_variant')
    expect(ec(remove('C', 'cap'))).toBeNull()
    expect(ec(remove('R', 'res'))).toBe('axis_required')
    expect(ec(remove('R', 'pkg'))).toBeNull()
    expect(ec(remove('M', 'pkg'))).toBeNull()
    expect(ec(remove('R', 'nope'))).toBe('not_found')
  })
  it('item.reorderAxes must list exactly the axes of the item', () => {
    const reorder = (itemId: string, attributeIds: string[]): Command => ({ type: 'item.reorderAxes', itemId, attributeIds })
    expect(ec(reorder('C', ['volt', 'cap']))).toBeNull()
    expect(ec(reorder('C', ['cap', 'volt']))).toBeNull()
    expect(ec(reorder('C', ['volt']))).toBe('invalid_option')
    expect(ec(reorder('C', ['volt', 'cap', 'cap']))).toBe('invalid_option')
    expect(ec(reorder('C', ['volt', 'res']))).toBe('invalid_option')
    expect(ec(reorder('C', ['volt', 'cap', 'res']))).toBe('invalid_option')
    expect(ec(reorder('R', ['res', 'pkg']))).toBe('invalid_option')
    expect(ec(reorder('M', []))).toBeNull()
  })
})

describe('attribute dictionary', () => {
  const ec = (c: Command, s: InventorySnapshot = electronics()) => code(c, s)
  const create = (over: Partial<Extract<Command, { type: 'attribute.create' }>> = {}): Command => ({
    type: 'attribute.create', id: U('300'), inventoryId: 'inv', name: 'Power', kind: 'number', options: [], unit: 'W', siPrefixes: true, ...over,
  })

  it('attribute.create takes a number kind with a unit of up to 16 characters', () => {
    expect(ec(create())).toBeNull()
    expect(ec(create({ unit: '' }))).toBeNull()
    expect(ec(create({ unit: 'x'.repeat(16) }))).toBeNull()
    expect(ec(create({ unit: 'x'.repeat(17) }))).toBe('name_too_long')
    expect(ec(create({ kind: 'decimal' as 'number' }))).toBe('invalid_option')
  })
  it('attribute.update checks the unit length', () => {
    expect(ec({ type: 'attribute.update', id: 'res', unit: 'Ohm', siPrefixes: false })).toBeNull()
    expect(ec({ type: 'attribute.update', id: 'res', unit: 'x'.repeat(17) })).toBe('name_too_long')
  })
  it('units are for numbers only', () => {
    const n = (c: Command) => normalizeCommand(c) as Extract<Command, { type: 'attribute.create' }>
    for (const kind of ['text', 'enum'] as const) {
      expect(n(create({ kind, unit: 'W', siPrefixes: true }))).toMatchObject({ unit: '', siPrefixes: false })
    }
    expect(n(create())).toMatchObject({ unit: 'W', siPrefixes: true })
    expect(ec({ type: 'attribute.update', id: 'mark', unit: 'W' })).toBe('invalid_option')
    expect(ec({ type: 'attribute.update', id: 'pkg', siPrefixes: true })).toBe('invalid_option')
    expect(ec({ type: 'attribute.update', id: 'mark', unit: ' ', siPrefixes: false })).toBeNull()
    expect(ec({ type: 'attribute.update', id: 'res', unit: 'Ohm', siPrefixes: true })).toBeNull()
  })
  it('attribute.update refuses to drop a list option that is in use', () => {
    const options = (id: string, o: string[]): Command => ({ type: 'attribute.update', id, options: o })
    expect(ec(options('pkg', ['0603', 'THT']))).toBe('option_in_use') // shared value of R
    expect(ec(options('color', ['red', 'green']))).toBe('option_in_use') // value of variant lblue
    expect(ec(options('pkg', ['0805', '0603']))).toBeNull()
    expect(ec(options('pkg', ['THT', '0805', '0603', 'SOT-23']))).toBeNull()
    expect(ec(options('color', ['blue', 'green', 'red', 'white']))).toBeNull()
  })
  it('a value of an archived variant is in use too', () => {
    const s = electronics()
    const archived = { ...s, variants: s.variants.map((x) => (x.id === 'lblue' ? { ...x, ...ARCH } : x)) }
    expect(ec({ type: 'attribute.update', id: 'color', options: ['red', 'green'] }, archived)).toBe('option_in_use')
  })
  it('attribute.delete refuses an axis of an item with variants, archived ones included', () => {
    expect(ec({ type: 'attribute.delete', id: 'res' })).toBe('attribute_is_axis')
    expect(ec({ type: 'attribute.delete', id: 'volt' })).toBe('attribute_is_axis')
    expect(ec({ type: 'attribute.delete', id: 'pkg' })).toBeNull()
    expect(ec({ type: 'attribute.delete', id: 'mark' })).toBeNull()
    const s = electronics()
    const onlyArchived = { ...s, variants: s.variants.filter((x) => x.itemId !== 'R' || x.archivedAt !== null) }
    expect(ec({ type: 'attribute.delete', id: 'res' }, onlyArchived)).toBe('attribute_is_axis')
    const noVariants = { ...s, variants: s.variants.filter((x) => x.itemId !== 'R') }
    expect(ec({ type: 'attribute.delete', id: 'res' }, noVariants)).toBeNull()
  })
  it('pins at most two attributes of an inventory; unpinning always passes', () => {
    const pin = (id: string, pinned = true): Command => ({ type: 'attribute.update', id, pinned })
    const s = electronics()
    const pinnedAs = (ids: string[]) => ({ ...s, attributes: s.attributes.map((a) => ({ ...a, pinned: ids.includes(a.id) })) })
    expect(MAX_PINNED_ATTRIBUTES).toBe(2)
    expect(ec(pin('res'))).toBeNull()
    expect(ec(pin('pkg'), pinnedAs(['res']))).toBeNull()
    expect(ec(pin('mark'), pinnedAs(['res', 'pkg']))).toBe('too_many_pinned')
    expect(ec({ type: 'attribute.update', id: 'mark', name: 'Marking code', pinned: true }, pinnedAs(['res', 'pkg']))).toBe(
      'too_many_pinned',
    )
    // Already pinned: sent again (a retry, or a form saving other fields) it passes.
    expect(ec(pin('pkg'), pinnedAs(['res', 'pkg']))).toBeNull()
    // Unpinning passes, even with more pinned than allowed (another device pinned meanwhile).
    expect(ec(pin('res', false), pinnedAs(['res', 'pkg', 'mark']))).toBeNull()
    expect(ec(pin('volt', false), pinnedAs(['res', 'pkg', 'mark']))).toBeNull()
    // Other changes to an attribute leave the pins alone, whatever their number.
    expect(ec({ type: 'attribute.update', id: 'volt', name: 'U' }, pinnedAs(['res', 'pkg', 'mark']))).toBeNull()
    // Pins count per inventory: the snapshot holds one.
    expect(ec(pin('nope'))).toBe('not_found')
  })
})

describe('Plan 9 commands', () => {
  const ec = (c: Command, s: InventorySnapshot = electronics()) => code(c, s)
  type Values = Record<string, string | null>
  const setValues = (itemId: string, rows: [string, Values][]): Command => ({
    type: 'variant.setValues',
    itemId,
    rows: rows.map(([variantId, values]) => ({
      variantId,
      values: Object.entries(values).map(([attributeId, value]) => ({ attributeId, value })),
    })),
  })

  describe('variant.setValues', () => {
    it('passes two variants trading their values (Review Focus 1)', () => {
      expect(ec(setValues('R', [['r1k', { res: '10000' }], ['r10k', { res: '1000' }]]))).toBeNull()
      // The same trade as single-value changes, one at a time, is refused at the first step.
      expect(ec({ type: 'variant.setAttribute', variantId: 'r1k', attributeId: 'res', value: '10000' })).toBe('duplicate_variant')
      expect(ec(setValues('L', [['lblue', { color: 'red' }], ['lred', { color: 'green' }], ['lgreen', { color: 'blue' }]]))).toBeNull()
    })
    it('checks the final state, not each step (C2): 100n·50V -> 220n·25V next to 220n·50V', () => {
      const e = electronics()
      const s = {
        ...e,
        variantAttributeValues: e.variantAttributeValues.map((r) =>
          r.variantId === 'c16' ? { ...r, value: r.attributeId === 'cap' ? '0.00000022' : '50' } : r,
        ),
      }
      expect(ec(setValues('C', [['c50', { cap: '0.00000022', volt: '25' }]]), s)).toBeNull()
      expect(ec(setValues('C', [['c50', { cap: '0.00000022' }]]), s)).toBe('duplicate_variant')
      expect(ec(setValues('C', [['c50', { cap: '0.00000022', volt: '50' }]]), s)).toBe('duplicate_variant')
    })
    it('refuses a final state with two equal variants, an archived one counting', () => {
      expect(ec(setValues('R', [['r1k', { res: '4700' }]]))).toBe('duplicate_variant')
      expect(ec(setValues('L', [['lblue', { color: 'green' }], ['lred', { color: 'green' }]]))).toBe('duplicate_variant')
      expect(ec(setValues('C', [['c16', { volt: null }], ['c50', { volt: null }]]))).toBe('duplicate_variant')
      expect(ec(setValues('C', [['c16', { volt: null }]]))).toBeNull()
    })
    it('a repeat with the values already stored passes', () => {
      expect(ec(setValues('C', [['c50', { cap: '0.0000001', volt: '50' }], ['c16', { volt: '16' }]]))).toBeNull()
      expect(ec(setValues('R', []))).toBeNull()
    })
    it('takes axes of the item only, values checked by kind', () => {
      expect(ec(setValues('R', [['r1k', { pkg: '0603' }]]))).toBe('not_an_axis')
      expect(ec(setValues('R', [['r1k', { nope: 'x' }]]))).toBe('not_found')
      expect(ec(setValues('R', [['r1k', { res: '2k2' }]]))).toBe('invalid_number')
      expect(ec(setValues('L', [['lblue', { color: 'pink' }]]))).toBe('invalid_option')
      expect(ec(setValues('C', [['c50', { volt: '25' }], ['c50', { volt: '35' }]]))).toBe('invalid_option')
      const twice: Command = {
        type: 'variant.setValues', itemId: 'C',
        rows: [{ variantId: 'c50', values: [{ attributeId: 'volt', value: '25' }, { attributeId: 'volt', value: '35' }] }],
      }
      expect(ec(twice)).toBe('invalid_option')
    })
    it('needs active variants of the item', () => {
      expect(ec(setValues('R', [['c50', { res: '2200' }]]))).toBe('not_found')
      expect(ec(setValues('R', [['zz', { res: '2200' }]]))).toBe('not_found')
      expect(ec(setValues('R', [['r4k7', { res: '2200' }]]))).toBe('archived')
      expect(ec(setValues('zz', [['r1k', { res: '2200' }]]))).toBe('not_found')
      const s = electronics()
      const archived = { ...s, items: s.items.map((i) => (i.id === 'R' ? { ...i, ...ARCH } : i)) }
      expect(ec(setValues('R', [['r1k', { res: '2200' }]]), archived)).toBe('archived')
    })
    it('normalizeCommand trims the values; an empty one is null', () => {
      expect(normalizeCommand(setValues('C', [['c50', { cap: ' 0.0000001 ', volt: '  ' }]]))).toMatchObject({
        rows: [{ variantId: 'c50', values: [{ attributeId: 'cap', value: '0.0000001' }, { attributeId: 'volt', value: null }] }],
      })
    })
  })

  describe('variant.createMany with initial receipts', () => {
    const create = (variants: { id: string; res: string; initialReceipt?: { movementId: string; quantity: string } }[]): Command => ({
      type: 'variant.createMany',
      itemId: 'R',
      variants: variants.map(({ id, res, initialReceipt }) => ({
        id,
        values: [{ attributeId: 'res', value: res }],
        ...(initialReceipt ? { initialReceipt } : {}),
      })),
    })
    it('takes a positive quantity per variant; a variant without one is fine', () => {
      expect(ec(create([{ id: U('100'), res: '2200', initialReceipt: { movementId: U('200'), quantity: '10' } }, { id: U('101'), res: '3300' }]))).toBeNull()
      expect(ec(create([{ id: U('100'), res: '2200', initialReceipt: { movementId: U('200'), quantity: '0' } }]))).toBe('invalid_quantity')
      expect(ec(create([{ id: U('100'), res: '2200', initialReceipt: { movementId: U('200'), quantity: '-1' } }]))).toBe('invalid_quantity')
      expect(ec(create([{ id: U('100'), res: '2200', initialReceipt: { movementId: U('200'), quantity: 'ten' } }]))).toBe('invalid_quantity')
    })
    it('refuses one movement id for two receipts', () => {
      const receipt = { movementId: U('200'), quantity: '1' }
      expect(ec(create([{ id: U('100'), res: '2200', initialReceipt: receipt }, { id: U('101'), res: '3300', initialReceipt: receipt }]))).toBe('invalid_option')
    })
    it('a retry (the variant is stored with these values) passes with its receipt', () => {
      expect(ec(create([{ id: 'r1k', res: '1000', initialReceipt: { movementId: U('200'), quantity: '5' } }]))).toBeNull()
    })
    it('normalizeCommand canonicalizes the receipt quantity and leaves a variant without one alone', () => {
      const c = normalizeCommand(create([{ id: U('100'), res: '2200', initialReceipt: { movementId: U('200'), quantity: '1.50' } }, { id: U('101'), res: '3300' }]))
      expect(c).toMatchObject({ variants: [{ initialReceipt: { movementId: U('200'), quantity: '1.5' } }, {}] })
      expect((c as Extract<Command, { type: 'variant.createMany' }>).variants[1]).not.toHaveProperty('initialReceipt')
    })
  })

  describe('photo.replace', () => {
    const photo = (id: string, itemId: string, variantId: string | null, position: number) => ({
      id, itemId, variantId, provider: 'imgbb', fileId: id, url: `https://x/${id}`, position, createdAt: '', createdBy: '',
    })
    const withPhotos = () => ({ ...electronics(), photos: [photo('p1', 'R', null, 0), photo('p2', 'R', 'r1k', 1), photo('p3', 'C', 'c50', 0)] })
    const replace = (variantId: string, id: string, itemId = 'R'): Command => ({
      type: 'photo.replace', variantId, id, itemId, provider: 'imgbb', fileId: id, url: `https://x/${id}`,
    })
    it('replaces the photo of an active variant of the item, or adds one when it has none', () => {
      expect(ec(replace('r1k', U('300')), withPhotos())).toBeNull()
      expect(ec(replace('r10k', U('300')), withPhotos())).toBeNull()
    })
    it('a retry (the new photo is already the variant’s) passes; an id of another photo does not', () => {
      expect(ec(replace('r1k', 'p2'), withPhotos())).toBeNull()
      expect(ec(replace('r1k', 'p1'), withPhotos())).toBe('invalid_option')
      expect(ec(replace('r1k', 'p3'), withPhotos())).toBe('invalid_option')
    })
    it('needs an active variant of the item', () => {
      expect(ec(replace('c50', U('300')), withPhotos())).toBe('not_found')
      expect(ec(replace('zz', U('300')), withPhotos())).toBe('not_found')
      expect(ec(replace('r4k7', U('300')), withPhotos())).toBe('archived')
    })
  })
})
