import { emptyIntakeDraft, type IntakeDraftContent } from '@antresol/core'
import { describe, expect, it } from 'vitest'
import { ARCHIVED, folder, makeSnapshot } from '../../core/test/fixtures'
import { folderChoicesWithDraft, folderPathWithDraft } from '../src'

const s = makeSnapshot({
  folders: [folder('PAS', 'Passives'), folder('OLD', 'Old', null, ARCHIVED), folder('OLDKID', 'Kid', 'OLD'), folder('CAP', 'Caps', 'PAS')],
})
const draft: IntakeDraftContent = {
  ...emptyIntakeDraft(),
  newFolders: [
    { id: 'D1', name: 'Inductors', parentId: 'PAS' },
    { id: 'D2', name: 'SMD', parentId: 'D1' },
    { id: 'D3', name: 'Under old', parentId: 'OLD' },
  ],
}

describe('folderPathWithDraft', () => {
  it('goes through draft and existing folders from the root', () => {
    expect(folderPathWithDraft(s, draft, 'D2')).toEqual(['Passives', 'Inductors', 'SMD'])
    expect(folderPathWithDraft(s, draft, 'CAP')).toEqual(['Passives', 'Caps'])
  })
  it('the root and a folder that is gone have no path', () => {
    expect(folderPathWithDraft(s, draft, null)).toEqual([])
    expect(folderPathWithDraft(s, draft, 'GONE')).toEqual([])
    expect(folderPathWithDraft(s, { ...emptyIntakeDraft(), newFolders: [{ id: 'X', name: 'X', parentId: 'GONE' }] }, 'X')).toEqual([])
  })
  it('shows the path through archived ancestors', () => {
    expect(folderPathWithDraft(s, draft, 'D3')).toEqual(['Old', 'Under old'])
    expect(folderPathWithDraft(s, draft, 'OLDKID')).toEqual(['Old', 'Kid'])
  })
  it('a cycle ends instead of looping', () => {
    const loop = { ...emptyIntakeDraft(), newFolders: [{ id: 'A', name: 'A', parentId: 'B' }, { id: 'B', name: 'B', parentId: 'A' }] }
    expect(folderPathWithDraft(s, loop, 'A')).toEqual(['B', 'A'])
  })
})

describe('folderChoicesWithDraft', () => {
  it('lists the root, then folders depth-first, draft marked, archived left out', () => {
    const rows = folderChoicesWithDraft(s, draft, 'D1').map((c) => [c.name, c.depth, c.draft, c.current])
    expect(rows).toEqual([
      [s.inventory.name, 0, false, false],
      ['Passives', 1, false, false],
      ['Caps', 2, false, false],
      ['Inductors', 2, true, true],
      ['SMD', 3, true, false],
    ])
    const names = rows.map((r) => r[0])
    expect(names).not.toContain('Old')
    expect(names).not.toContain('Under old')
  })
  it('leaves out the moved draft folder with everything under it', () => {
    const names = folderChoicesWithDraft(s, draft, null, 'D1').map((c) => c.name)
    expect(names).not.toContain('Inductors')
    expect(names).not.toContain('SMD')
    expect(names).toContain('Caps')
  })
})
