import { afterEach, describe, expect, it } from 'vitest'
import { clearDraft, linkNeedsAmount, saveDraft, takeDraft, type QuickAddDraft } from '../app/lib/quick-add-draft'

const draft = (over: Partial<QuickAddDraft> = {}): QuickAddDraft => ({
  inventoryId: 'inv1',
  folderId: null,
  name: 'NE5532',
  unitKey: 'pcs',
  amount: '5',
  price: '',
  url: '',
  photo: null,
  ...over,
})
const none = { name: '', url: '' }

afterEach(clearDraft)

describe('quick add draft', () => {
  it('comes back on the next opening, once', () => {
    saveDraft(draft())
    expect(takeDraft('inv1', none)?.name).toBe('NE5532')
    expect(takeDraft('inv1', none)).toBeNull()
  })
  it('does not come back after being cleared (saved or discarded)', () => {
    saveDraft(draft())
    clearDraft()
    expect(takeDraft('inv1', none)).toBeNull()
  })
  it('does not keep an empty form, or one holding only the shared link', () => {
    saveDraft(draft({ name: ' ', amount: '' }))
    expect(takeDraft('inv1', none)).toBeNull()
    saveDraft(draft({ name: '', amount: '', url: 'https://x.test/a', prefilledUrl: 'https://x.test/a' }))
    expect(takeDraft('inv1', none)).toBeNull()
  })
  it('gives way to an opening with its own name or link, and to another inventory', () => {
    saveDraft(draft())
    expect(takeDraft('inv1', { name: 'LM358', url: '' })).toBeNull()
    saveDraft(draft())
    expect(takeDraft('inv1', { name: '', url: 'https://x.test' })).toBeNull()
    saveDraft(draft())
    expect(takeDraft('inv2', none)).toBeNull()
  })
  it('a newer draft replaces the older one', () => {
    saveDraft(draft())
    saveDraft(draft({ name: 'TL072' }))
    expect(takeDraft('inv1', none)?.name).toBe('TL072')
  })
})

describe('linkNeedsAmount', () => {
  it('is true for the shared link left as it came with no amount', () => {
    expect(linkNeedsAmount('https://x.test/a', 'https://x.test/a', '')).toBe(true)
    expect(linkNeedsAmount(' https://x.test/a ', 'https://x.test/a', '  ')).toBe(true)
  })
  it('is false with an amount, an edited link, no link or no share', () => {
    expect(linkNeedsAmount('https://x.test/a', 'https://x.test/a', '5')).toBe(false)
    expect(linkNeedsAmount('https://x.test/b', 'https://x.test/a', '')).toBe(false)
    expect(linkNeedsAmount('', '', '')).toBe(false)
    expect(linkNeedsAmount('https://x.test/a', undefined, '')).toBe(false)
  })
})
