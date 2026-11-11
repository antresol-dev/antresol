import { newId, variantLabel, type Id, type InventorySnapshot, type InventoryStorage } from '@graymatter/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoDriver } from '../app/lib/dev/demo-source'
import { boughtRows, cleanTitle, isShareLike, lotKey, parseShare, shareMatches, shareParams, shopLinks, valueChips } from '../app/lib/share'
import type { SourceConfig } from '../app/lib/types'

const ALI = 'https://www.aliexpress.com/item/1005001234567890.html'

describe('parseShare', () => {
  it('cleans an AliExpress title and keys the lot by the item id (the Android share puts the link in text)', () => {
    const r = parseShare({ text: `600PCS 1/4W Metal Film Resistor 1% 10K 4.7K ${ALI}` })
    expect(r).toEqual({ query: '1/4W Metal Film Resistor 1% 10K 4.7K', url: ALI, lotKey: '1005001234567890' })
  })

  it('prefers the url parameter and falls back to the title', () => {
    const r = parseShare({ title: 'NE5532P DIP-8 - AliExpress 502', text: '', url: `${ALI}?spm=a2g0o.detail` })
    expect(r).toEqual({ query: 'NE5532P DIP-8', url: `${ALI}?spm=a2g0o.detail`, lotKey: '1005001234567890' })
  })

  it('has no lot key for a short link, and still a query', () => {
    const r = parseShare({ text: 'Check out this product! 10PCS TL072CP DIP-8 https://a.aliexpress.com/_mKpQ7xY' })
    expect(r).toEqual({ query: 'TL072CP DIP-8', url: 'https://a.aliexpress.com/_mKpQ7xY', lotKey: null })
  })

  it('works with nothing shared but text', () => {
    expect(parseShare({ text: 'tl072' })).toEqual({ query: 'tl072', url: null, lotKey: null })
    expect(parseShare({})).toEqual({ query: '', url: null, lotKey: null })
  })

  it('ignores a url parameter that is not a web address', () => {
    expect(parseShare({ text: 'TL072', url: 'javascript:alert(1)' }).url).toBeNull()
  })
})

describe('shareParams', () => {
  it('reads the share route query, taking the first of a repeated parameter', () => {
    expect(shareParams({ text: 'TL072 https://x.example/a', title: ['A', 'B'], url: undefined })).toEqual({
      title: 'A',
      text: 'TL072 https://x.example/a',
      url: null,
    })
    expect(shareParams({})).toEqual({ title: null, text: null, url: null })
  })
})

describe('cleanTitle', () => {
  it.each([
    ['Free Shipping 100PCS/LOT New Original NE5532P DIP-8 (Dual Op-Amp)', 'NE5532P DIP-8 Dual Op-Amp'],
    ['Lot of 10 TL072CP', 'TL072CP'],
    ['10 pcs 【Hot Sale】 LM358 + Brand New!!', 'LM358'],
    ['5шт Резистор 0,25 Вт', 'Резистор 0,25 Вт'],
    ['100% Original 1N4148 | In Stock', '1N4148'],
    ['  Electrolytic capacitor 47uF 25V, 50PCS  ', 'Electrolytic capacitor 47uF 25V'],
  ])('%s', (raw, clean) => {
    expect(cleanTitle(raw)).toBe(clean)
  })

  it('keeps values: fractions, percent, decimal points and part-number dashes', () => {
    expect(cleanTitle('1/4W 1% 4.7K 4,7K DIP-8')).toBe('1/4W 1% 4.7K 4,7K DIP-8')
  })
})

describe('lotKey', () => {
  it('is the AliExpress item id on any AliExpress host', () => {
    expect(lotKey(ALI)).toBe('1005001234567890')
    expect(lotKey('https://m.aliexpress.us/item/1005001234567890.html?gatewayAdapt=glo2usa')).toBe('1005001234567890')
    expect(lotKey('https://aliexpress.ru/item/1005001234567890.html')).toBe('1005001234567890')
  })

  it('is null for AliExpress links without an item id', () => {
    expect(lotKey('https://a.aliexpress.com/_mKpQ7xY')).toBeNull()
    expect(lotKey('https://s.click.aliexpress.com/e/_DlXyz')).toBeNull()
    expect(lotKey('https://www.aliexpress.com/store/123456')).toBeNull()
  })

  it('is the address without www, parameters or a trailing slash elsewhere, lowercased', () => {
    expect(lotKey('https://www.LCSC.com/product-detail/C7593.html?s_z=n_tl072#x')).toBe('lcsc.com/product-detail/c7593.html')
    expect(lotKey('https://www.thonk.co.uk/shop/tl072/')).toBe('thonk.co.uk/shop/tl072')
  })

  it('is null for a bare host and for what is not a web address', () => {
    expect(lotKey('https://www.taydaelectronics.com/')).toBeNull()
    expect(lotKey('tl072.pdf')).toBeNull()
    expect(lotKey('ftp://example.com/a')).toBeNull()
  })
})

describe('isShareLike', () => {
  it('is false for an ordinary query that looks like a file or a host', () => {
    expect(isShareLike('tl072.pdf')).toBe(false)
    expect(isShareLike('aliexpress.com')).toBe(false)
    expect(isShareLike('10k resistor')).toBe(false)
  })

  it('is true for a web address, alone or inside text', () => {
    expect(isShareLike(ALI)).toBe(true)
    expect(isShareLike(`TL072 ${ALI}`)).toBe(true)
  })

  it('is true for a long title only: at least 40 characters and 4 words', () => {
    expect(isShareLike('600PCS 1/4W Metal Film Resistor 1% 10K 4.7K')).toBe(true)
    expect(isShareLike('Electrolytic-capacitor-47uF-25V-radial-through-hole')).toBe(false)
    expect(isShareLike('Metal Film Resistor 1% 10K')).toBe(false)
  })
})

describe('shopLinks', () => {
  it('searches six shops by the name', () => {
    const links = shopLinks('TL072 op-amp')
    expect(links.map((l) => l.name)).toEqual(['LCSC', 'AliExpress', 'Mouser', 'Tayda', 'Thonk', 'Octopart'])
    for (const l of links) {
      expect(l.url).toMatch(/^https:\/\//)
      expect(l.url).toContain('TL072%20op-amp')
    }
  })
})

const cfg: SourceConfig = {
  id: 'demo',
  kind: 'dev-pglite',
  name: 'Demo',
  connectionString: '',
  uploadcarePublicKey: null,
  createdAt: '2026-11-10T00:00:00Z',
}

describe('with the demo inventory', () => {
  const driver = createDemoDriver({ memory: true, extras: false })
  afterAll(() => driver.close())
  let storage: InventoryStorage
  let snap: InventorySnapshot
  let resistor: Id

  beforeAll(async () => {
    storage = (await driver.connect(cfg)).storage
    const id = (await storage.listInventories()).inventories.find((i) => i.name === 'Electronics')!.id
    snap = await storage.loadInventory(id)
    resistor = snap.items.find((i) => i.name === 'Резистор 0,25 Вт')!.id
  })

  it('reads value chips by the inventory number attributes: in stock, known but empty, unknown', () => {
    const chips = valueChips('1/4W Metal Film Resistor 1% 10K 4.7K 47K 1K 100k 600', snap)
    expect(chips).toEqual([
      { text: '10K', number: '100', inStock: true },
      { text: '4.7K', number: null, inStock: false },
      { text: '47K', number: null, inStock: false },
      { text: '1K', number: '0', inStock: false },
      { text: '100k', number: '0', inStock: false },
    ])
  })

  it('reads a value once however often it is written', () => {
    expect(valueChips('10K 10k 10000Ω', snap).map((c) => c.text)).toEqual(['10K'])
  })

  it('finds the best matches for a cleaned title, the 10K variant among them', () => {
    const rows = shareMatches('Metal Film Resistor 1% 10K', snap)
    expect(rows.length).toBeLessThanOrEqual(5)
    const ten = variantLabel(snap, snap.variants.find((v) => v.itemId === resistor && variantLabel(snap, v).startsWith('10 k'))!)
    expect(rows[0]).toMatchObject({ itemId: resistor, variantName: ten, number: '100' })
    expect(shareMatches('', snap)).toEqual([])
    // "1" of "1/4W" and "1%" is no word of its own: it would match "16 V" and "100 nF" as a prefix.
    expect(shareMatches('1/4W Metal Film Resistor 1% 10K', snap).map((r) => r.name)).toEqual(['Резистор 0,25 Вт'])
  })

  it('describes earlier receipts of the lot with what is left of them', () => {
    const tl = snap.items.find((i) => i.name === 'TL072')!.id
    const ten = snap.variants.find((v) => v.itemId === resistor && variantLabel(snap, v).startsWith('10 k'))!.id
    const rows = boughtRows(
      [
        { at: '2026-08-12T10:00:00Z', itemId: resistor, variantId: ten, quantity: '100' },
        { at: '2026-07-01T10:00:00Z', itemId: tl, variantId: null, quantity: '40' },
        { at: '2026-06-01T10:00:00Z', itemId: newId(), variantId: null, quantity: '5' },
      ],
      snap,
    )
    expect(rows.map(({ name, variantName, bought, left }) => ({ name, variantName, bought, left }))).toEqual([
      { name: 'Резистор 0,25 Вт', variantName: '10 kΩ', bought: '100 pcs', left: '100 pcs' },
      { name: 'TL072', variantName: null, bought: '40 pcs', left: '37 pcs' },
    ])
    expect(rows[0]!.at).toBe('2026-08-12T10:00:00Z')
  })
})
