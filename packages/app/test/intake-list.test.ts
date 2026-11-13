import { newId, type Intake, type InventorySnapshot } from '@antresol/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { intakeRows, intakeTitle, searchIntakes } from '../app/lib/intake-list'
import type { SourceConfig } from '../app/lib/types'

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}
const driver = createDemoDriver({ memory: true, extras: false })
afterAll(() => driver.close())

let s: InventorySnapshot
let tl072: string
beforeAll(async () => {
  const { storage } = await driver.connect(cfg)
  const inventoryId = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
  s = await storage.loadInventory(inventoryId)
  tl072 = s.items.find((i) => i.name === 'TL072')!.id
})

const base = { inventoryId: 'inv', draftRev: 'r', createdAt: '2026-11-12T10:00:00Z', createdBy: 'Phone', updatedAt: '2026-11-12T10:00:00Z', updatedBy: 'Phone' }
const header = (shop: string | null, orderNumber: string | null, purchasedOn: string) => ({ shop, orderNumber, purchasedOn, note: null })

function committed(shop: string | null, order: string | null, on: string, at: string, names: string[]): Intake {
  return {
    ...base,
    id: newId(),
    status: 'committed',
    header: header(shop, order, on),
    draft: null,
    lines: names.map((itemName) => ({
      lineId: newId(), kind: 'newItem' as const, itemId: newId(), variantId: null, movementId: newId(),
      itemName, variantLabel: null, quantity: '1', unitKey: 'pcs', totalPrice: null, sourceUrl: null,
    })),
    committedAt: at,
  }
}
function draft(shop: string | null, order: string | null, on: string, newNames: string[], existing: string[] = []): Intake {
  const newItems = newNames.map((name) => ({ id: newId(), name, folderId: null, unitKey: 'pcs', attributes: [] }))
  const line = (itemId: string) => ({
    id: newId(), itemId, axisValues: [], quantity: '1', totalPrice: null, sourceUrl: null, photo: null,
    ids: { movementId: newId(), variantId: newId(), photoId: newId() },
  })
  return {
    ...base,
    id: newId(),
    status: 'draft',
    header: header(shop, order, on),
    draft: { newItems, lines: [...newItems.map((n) => line(n.id)), ...existing.map(line)] },
    lines: null,
    committedAt: null,
  }
}

describe('intakeTitle', () => {
  it('names an intake by shop and order number, else by its date', () => {
    expect(intakeTitle(header('LCSC', 'WM2511-0042', '2026-11-12'))).toBe('LCSC · #WM2511-0042')
    expect(intakeTitle(header('LCSC', null, '2026-11-12'))).toBe('LCSC')
    expect(intakeTitle(header(null, 'A1', '2026-11-12'))).toBe('#A1')
    expect(intakeTitle(header(null, null, '2026-11-12'))).toBe('Intake · 12 Nov')
    expect(intakeTitle(header('  ', '', '2026-11-12'))).toBe('Intake · 12 Nov')
  })
})

describe('intakeRows', () => {
  it('lists drafts first, then committed by purchase date and commit time, newest first', () => {
    const old = committed('A', null, '2026-11-01', '2026-11-02T10:00:00Z', ['x'])
    const sameDayLate = committed('B', null, '2026-11-10', '2026-11-12T10:00:00Z', ['x', 'y'])
    const sameDayEarly = committed('C', null, '2026-11-10', '2026-11-11T10:00:00Z', ['x'])
    const d = draft('D', null, '2026-11-05', ['esp32'])
    const rows = intakeRows([old, sameDayEarly, d, sameDayLate], s)
    expect(rows.map((r) => r.title)).toEqual(['D', 'B', 'C', 'A'])
    expect(rows[0]).toMatchObject({ id: d.id, status: 'draft', lineCount: 1, by: 'Phone' })
    expect(rows[1]!.lineCount).toBe(2)
  })
})

describe('searchIntakes', () => {
  const lcsc = committed('LCSC', 'WM2511-0042', '2026-11-12', '2026-11-12T11:00:00Z', ['ESP32-C3 module', 'Header'])
  const other = committed('Mouser', '77-1', '2026-11-03', '2026-11-03T11:00:00Z', ['Capacitor'])
  let pending: Intake
  let all: Intake[]
  beforeAll(() => {
    pending = draft('Digikey', null, '2026-11-13', ['ESP32-S3 board'], [tl072])
    all = [lcsc, other, pending]
  })

  it('finds by item names in committed lines and in new items of a draft', () => {
    expect(searchIntakes(all, s, 'esp32').map((i) => i.id).sort()).toEqual([lcsc.id, pending.id].sort())
  })
  it('finds a draft by the current name of an existing item', () => {
    expect(searchIntakes(all, s, 'tl072').map((i) => i.id)).toEqual([pending.id])
  })
  it('finds by shop and by order number without regard to case', () => {
    expect(searchIntakes(all, s, 'wm2511').map((i) => i.id)).toEqual([lcsc.id])
    expect(searchIntakes(all, s, 'MOUSER').map((i) => i.id)).toEqual([other.id])
  })
  it('an empty query keeps everything; every word has to match', () => {
    expect(searchIntakes(all, s, '  ')).toEqual(all)
    expect(searchIntakes(all, s, 'lcsc header').map((i) => i.id)).toEqual([lcsc.id])
    expect(searchIntakes(all, s, 'lcsc capacitor')).toEqual([])
  })
})
