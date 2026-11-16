import { emptyIntakeDraft, newId, type DraftNewItem, type IntakeDraftContent, type ResolvedIntake } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { commitLabel } from '../app/lib/intake-line'

const item = (name: string): DraftNewItem => ({ id: newId(), name, folderId: null, unitKey: 'pcs', attributes: [] })
const resolved = (lines: number, entities: ResolvedIntake['entities']): ResolvedIntake => ({
  lines: Array.from({ length: lines }, () => ({ lineId: newId(), resolution: { kind: 'newItem' } as never })),
  entities,
  ok: true,
})
const draft = (lines: number, items: DraftNewItem[]): IntakeDraftContent => ({
  ...emptyIntakeDraft(),
  newItems: items,
  lines: Array.from({ length: lines }, () => ({}) as never),
})

describe('commitLabel', () => {
  it('counts the lines first', () => {
    expect(commitLabel(draft(3, []), resolved(3, []))).toEqual({ key: 'intakes.screen.commitLines', count: 3 })
  })
  it('counts new items when there are no lines', () => {
    const items = [item('a'), item('b')]
    const entities = items.map((i) => ({ kind: 'item' as const, id: i.id, problem: null }))
    expect(commitLabel(draft(0, items), resolved(0, entities))).toEqual({ key: 'intakes.screen.commitItems', count: 2 })
  })
  it('counts folders and attributes alone', () => {
    expect(commitLabel(draft(0, []), resolved(0, [{ kind: 'folder', id: newId(), problem: null }]))).toEqual({ key: 'intakes.screen.commitParts', count: 1 })
  })
  it('is null with nothing in the draft', () => {
    const d = emptyIntakeDraft()
    expect(commitLabel(d, resolved(0, []))).toBeNull()
  })
})
