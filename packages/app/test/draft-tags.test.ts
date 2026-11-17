import { describe, expect, it } from 'vitest'
import { draftTagAliases, tagPicked, togglePicked } from '../app/lib/draft-tags'

const real = [{ id: 'R1', name: 'SMD' }, { id: 'R2', name: 'Op-amps' }]
const draft = [{ id: 'D1', name: ' smd ' }, { id: 'D2', name: 'Fresh' }]

describe('draft tags named like a real tag', () => {
  const aliases = draftTagAliases(real, draft)

  it('maps only the draft tag that matches a real name (trim, no case)', () => {
    expect([...aliases]).toEqual([['D1', 'R1']])
  })

  it('the real tag shows picked when the item holds the draft id', () => {
    expect(tagPicked(['D1'], 'R1', aliases)).toBe(true)
    expect(tagPicked(['R1'], 'R1', aliases)).toBe(true)
    expect(tagPicked(['D2'], 'R1', aliases)).toBe(false)
    expect(tagPicked([], 'R2', aliases)).toBe(false)
  })

  it('unticking removes the real id and the draft id; ticking adds the real id only', () => {
    expect(togglePicked(['D1', 'D2'], 'R1', false, aliases)).toEqual(['D2'])
    expect(togglePicked(['D1', 'R1'], 'R1', false, aliases)).toEqual([])
    expect(togglePicked(['D2'], 'R1', true, aliases)).toEqual(['D2', 'R1'])
    expect(togglePicked(['R1'], 'R1', true, aliases)).toEqual(['R1'])
  })
})
