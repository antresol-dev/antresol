import { describe, expect, it } from 'vitest'
import { similarNames } from '../src'

const rows = (...names: string[]) => names.map((name, i) => ({ id: `id${i}`, name, where: 'Passives' }))
const why = (cands: string[], name: string) => similarNames(rows(...cands), name).map((r) => [r.name, r.why])

describe('similarNames', () => {
  it('finds a plural, a spacing variant, a typo and a whole-word containment', () => {
    expect(why(['Resistor'], 'Resistors')).toEqual([['Resistor', 'plural']])
    expect(why(['Resistors'], 'Resistor')).toEqual([['Resistors', 'plural']])
    expect(why(['Box'], 'Boxes')).toEqual([['Box', 'plural']])
    expect(why(['Resistor'], 'Res-istor')).toEqual([['Resistor', 'spacing']])
    expect(why(['Fuse holder'], 'fuse_holder')).toEqual([['Fuse holder', 'spacing']])
    expect(why(['Resistor'], 'Resitor')).toEqual([['Resistor', 'typo']])
    expect(why(['Resistor'], 'Reisstor')).toEqual([['Resistor', 'typo']])
    expect(why(['Resistor'], 'SMD Resistor')).toEqual([['Resistor', 'contains']])
    expect(why(['SMD Resistor'], 'Resistor')).toEqual([['SMD Resistor', 'contains']])
  })

  it('keeps id and where, and orders spacing, plural, typo, contains', () => {
    const out = similarNames(
      [
        { id: 'a', name: 'SMD Resistor' },
        { id: 'b', name: 'Resitor', where: 'Old' },
        { id: 'c', name: 'Resistors', where: 'New' },
        { id: 'd', name: 'Re-sistor' },
      ],
      'Resistor',
    )
    expect(out.map((r) => [r.id, r.why])).toEqual([
      ['d', 'spacing'],
      ['c', 'plural'],
      ['b', 'typo'],
      ['a', 'contains'],
    ])
    expect(out[1]).toEqual({ id: 'c', name: 'Resistors', where: 'New', why: 'plural' })
  })

  it('allows two edits only from length 6, one edit for shorter names', () => {
    expect(why(['Capacitor'], 'Capcitr')).toEqual([['Capacitor', 'typo']])
    expect(why(['Fuse'], 'Fuze')).toEqual([['Fuse', 'typo']])
    expect(why(['Fuse'], 'Fzze')).toEqual([])
    expect(why(['Diode'], 'Dxoxe')).toEqual([])
  })

  it('reports an equal name (a candidate that is no hard duplicate, e.g. another folder) as same, first', () => {
    expect(why(['Resistor'], 'resistor')).toEqual([['Resistor', 'same']])
    expect(why(['Resistors', ' resistor '], 'Resistor')).toEqual([[' resistor ', 'same'], ['Resistors', 'plural']])
  })

  it('does not report unrelated names', () => {
    expect(why(['Capacitor', 'Module'], 'Resistor')).toEqual([])
    expect(why(['Resistors'], '  ')).toEqual([])
    expect(why(['Resistor'], 'Resis')).toEqual([])
  })
})
