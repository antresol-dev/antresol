import { describe, expect, it } from 'vitest'
import type { Command } from '../src/commands'
import { folderNameTaken, itemNameTaken, unitClash } from '../src'
import type { InventorySnapshot } from '../src/model'
import { normalizeCommand, validateCommand, type DomainErrorCode } from '../src/validate'
import { attribute, folder, item, makeSnapshot } from './fixtures'

const ARCH = { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'arch' }
const U = (n: string) => `00000000-0000-7000-8000-${n.padStart(12, '0')}`
const unit = (id: string, name: string, symbol: string) => ({ id, inventoryId: 'inv', name, symbol, prefixPowers: [], createdAt: '', updatedAt: '', createdBy: '', updatedBy: '' })

function snap(): InventorySnapshot {
  return makeSnapshot({
    folders: [
      folder('F', 'Shelf'),
      folder('G', 'Boxes'),
      folder('F2', 'Drawer', 'F'),
      folder('F3', 'Drawer', 'G'),
      folder('AF', 'Old shelf', null, ARCH),
      folder('RF', 'Revived', 'F', ARCH),
    ],
    items: [
      item('i1', 'Resistor', 'F'),
      item('i2', 'Capacitor', 'F'),
      item('i3', 'Diode', 'F', ARCH),
      item('i4', 'Resistor', 'G'),
      item('i5', 'Lamp', 'G', ARCH),
      item('i6', 'Lamp', 'G'),
    ],
    attributes: [attribute('a1', 'Package'), attribute('a2', 'Color')],
    units: [unit('u1', 'Roll', 'roll'), unit('u2', 'Millilitre', 'mL')],
  })
}
const code = (c: Command, s: InventorySnapshot | null = snap()): DomainErrorCode | null => validateCommand(normalizeCommand(c), s)?.code ?? null
const newItem = (name: string, folderId: string | null, id = U('9')): Command => ({
  type: 'item.create', id, inventoryId: 'inv', folderId, name, description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null,
})
const newFolder = (name: string, parentId: string | null, id = U('8')): Command => ({
  type: 'folder.create', id, inventoryId: 'inv', parentId, name, description: null,
})
const newUnit = (name: string, symbol: string, id = U('7')): Command => ({ type: 'unit.create', id, inventoryId: 'inv', name, symbol, prefixPowers: [] })

describe('no hard duplicates: items', () => {
  it('item.create', () => {
    expect(code(newItem('Resistor', 'F'))).toBe('duplicate_name')
    expect(code(newItem('  resistor ', 'F'))).toBe('duplicate_name')
    expect(code(newItem('Diode', 'F'))).toBe('duplicate_archived')
    expect(code(newItem('Capacitor', 'G'))).toBeNull()
    expect(code(newItem('Capacitor', null))).toBeNull()
  })
  it('a living twin beats an archived one', () => {
    expect(code(newItem('Lamp', 'G'))).toBe('duplicate_name')
  })
  it('a retried item.create passes', () => {
    expect(code(newItem('Resistor', 'F', 'i1'))).toBeNull()
  })
  it('item.update rename and move', () => {
    expect(code({ type: 'item.update', id: 'i2', name: 'resistor' })).toBe('duplicate_name')
    expect(code({ type: 'item.update', id: 'i2', name: 'Diode' })).toBe('duplicate_archived')
    expect(code({ type: 'item.update', id: 'i1', name: 'RESISTOR' })).toBeNull()
    expect(code({ type: 'item.update', id: 'i4', folderId: 'F' })).toBe('duplicate_name')
    expect(code({ type: 'item.update', id: 'i4', folderId: 'G' })).toBeNull()
    expect(code({ type: 'item.update', id: 'i2', description: 'x' })).toBeNull()
    expect(code({ type: 'item.update', id: 'i6', folderId: null })).toBeNull()
  })
  it('restore of an item whose name a living sibling took', () => {
    const s = snap()
    s.items.push(item('i7', 'Diode', 'F'))
    expect(code({ type: 'restore', archiveId: 'arch' }, s)).toBe('duplicate_name')
  })
  it('helpers', () => {
    const s = snap()
    expect(itemNameTaken(s, 'F', ' resistor ')).toBe('active')
    expect(itemNameTaken(s, 'F', 'diode')).toBe('archived')
    expect(itemNameTaken(s, 'F', 'Nope')).toBeNull()
    expect(itemNameTaken(s, 'F', 'Resistor', 'i1')).toBeNull()
  })
})

describe('no hard duplicates: folders', () => {
  it('folder.create', () => {
    expect(code(newFolder('drawer', 'F'))).toBe('duplicate_name')
    expect(code(newFolder('Old shelf', null))).toBe('duplicate_archived')
    expect(code(newFolder('Drawer', null))).toBeNull()
    expect(code(newFolder('Drawer', 'F', 'F2'))).toBeNull()
  })
  it('folder.update and folder.move', () => {
    expect(code({ type: 'folder.update', id: 'G', name: 'shelf' })).toBe('duplicate_name')
    expect(code({ type: 'folder.update', id: 'G', name: 'Old shelf' })).toBe('duplicate_archived')
    expect(code({ type: 'folder.update', id: 'F2', name: 'DRAWER' })).toBeNull()
    expect(code({ type: 'folder.update', id: 'F2', description: 'x' })).toBeNull()
    expect(code({ type: 'folder.move', id: 'F3', parentId: 'F' })).toBe('duplicate_name')
    expect(code({ type: 'folder.move', id: 'F3', parentId: null })).toBeNull()
  })
  it('restore of a folder whose name a living sibling took', () => {
    const s = snap()
    s.folders.push(folder('X', 'Revived', 'F'))
    expect(code({ type: 'restore', archiveId: 'arch' }, s)).toBe('duplicate_name')
  })
  it('helper', () => {
    const s = snap()
    expect(folderNameTaken(s, 'F', 'drawer')).toBe('active')
    expect(folderNameTaken(s, null, 'old shelf')).toBe('archived')
    expect(folderNameTaken(s, 'F', 'Drawer', 'F2')).toBeNull()
  })
})

describe('no hard duplicates: attributes', () => {
  it('attribute.create and update', () => {
    expect(code({ type: 'attribute.create', id: U('6'), inventoryId: 'inv', name: ' package ', kind: 'text', options: [], unit: '', siPrefixes: false })).toBe('duplicate_name')
    expect(code({ type: 'attribute.create', id: U('6'), inventoryId: 'inv', name: 'Size', kind: 'text', options: [], unit: '', siPrefixes: false })).toBeNull()
    expect(code({ type: 'attribute.create', id: 'a1', inventoryId: 'inv', name: 'Package', kind: 'text', options: [], unit: '', siPrefixes: false })).toBeNull()
    expect(code({ type: 'attribute.update', id: 'a2', name: 'package' })).toBe('duplicate_name')
    expect(code({ type: 'attribute.update', id: 'a1', name: 'PACKAGE' })).toBeNull()
  })
})

describe('no hard duplicates: units', () => {
  it('unit.create by name, built-in too', () => {
    expect(code(newUnit('meters', 'mtr'))).toBe('duplicate_name')
    expect(code(newUnit(' roll ', 'rl'))).toBe('duplicate_name')
    expect(code(newUnit('Metre', 'mtr'))).toBeNull()
  })
  it('unit.create by symbol, case-sensitive', () => {
    expect(code(newUnit('Metre', 'm'))).toBe('duplicate_name')
    expect(code(newUnit('Metre', ' m '))).toBe('duplicate_name')
    expect(code(newUnit('Mega', 'M'))).toBeNull()
    expect(code(newUnit('Mill', 'ml'))).toBeNull()
    expect(code(newUnit('Mill', 'mL'))).toBe('duplicate_name')
  })
  it('a retried unit.create passes', () => {
    expect(code(newUnit('Roll', 'roll', 'u1'))).toBeNull()
  })
  it('unit.update never clashes with itself', () => {
    expect(code({ type: 'unit.update', id: 'u1', name: 'ROLL', symbol: 'roll' })).toBeNull()
    expect(code({ type: 'unit.update', id: 'u1', name: 'grams' })).toBe('duplicate_name')
    expect(code({ type: 'unit.update', id: 'u1', symbol: 'mL' })).toBe('duplicate_name')
    expect(code({ type: 'unit.update', id: 'u1', symbol: 'ml' })).toBeNull()
    expect(code({ type: 'unit.update', id: 'u1', prefixPowers: [3] })).toBeNull()
  })
  it('helper', () => {
    const s = snap()
    expect(unitClash(s, { name: 'meters', symbol: 'x' })).toBe('name')
    expect(unitClash(s, { name: 'X', symbol: 'm' })).toBe('symbol')
    expect(unitClash(s, { name: 'X', symbol: 'M' })).toBeNull()
    expect(unitClash(s, { name: 'Roll', symbol: 'roll' }, 'u1')).toBeNull()
  })
})
