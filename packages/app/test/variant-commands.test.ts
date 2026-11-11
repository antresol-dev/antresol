import { describe, expect, it } from 'vitest'
import { rowClashes, setValuesCommand } from '../app/lib/variant-commands'
import { axisSnapshot } from './fixtures/axis-snapshot'

describe('setValuesCommand', () => {
  it('builds one variant.setValues from the changed rows only', () => {
    expect(setValuesCommand('R', [{ variantId: 'r10k', values: { res: '4700' } }, { variantId: 'r1k', values: {} }])).toEqual({
      type: 'variant.setValues',
      itemId: 'R',
      rows: [{ variantId: 'r10k', values: [{ attributeId: 'res', value: '4700' }] }],
    })
    expect(setValuesCommand('R', [{ variantId: 'r1k', values: {} }])).toBeNull()
  })
})

describe('rowClashes', () => {
  it('judges the final state: a swap is no clash, a duplicate is, an archived one offers Restore', () => {
    const s = axisSnapshot()
    const value = (id: string) => s.variantAttributeValues.find((v) => v.variantId === id && v.attributeId === 'res')?.value ?? null
    const [a, b] = [value('r10k'), value('r1k')]
    expect(rowClashes(s, 'R', [{ variantId: 'r10k', values: { res: b } }, { variantId: 'r1k', values: { res: a } }])).toEqual([])
    const same = rowClashes(s, 'R', [{ variantId: 'r10k', values: { res: b } }])
    expect(same.map((c) => [c.variantId, c.other.id, c.archived])).toEqual([['r10k', 'r1k', false]])
    const archived = rowClashes(s, 'R', [{ variantId: 'r10k', values: { res: value('r4k7') } }])
    expect(archived[0]).toMatchObject({ archived: true, archiveId: 'arch' })
  })
})
