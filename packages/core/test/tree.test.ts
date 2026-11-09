import { describe, expect, it } from 'vitest'
import { childFolders, folderPath, isInSubtree, itemsInFolder } from '../src/tree'
import { folder, item, makeSnapshot } from './fixtures'

describe('tree', () => {
  it('childFolders sorts naturally and hides archived', () => {
    const s = makeSnapshot({
      folders: [
        folder('a', 'Folder 10'),
        folder('b', 'Folder 2'),
        folder('c', 'Old', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'x' }),
      ],
    })
    expect(childFolders(s, null).map((f) => f.name)).toEqual(['Folder 2', 'Folder 10'])
  })

  const s = makeSnapshot({ folders: [folder('F', 'F'), folder('G', 'G', 'F')] })
  it('folderPath goes root to folder', () => {
    expect(folderPath(s, 'G').map((f) => f.id)).toEqual(['F', 'G'])
  })
  it('isInSubtree', () => {
    expect(isInSubtree(s, 'F', 'G')).toBe(true)
    expect(isInSubtree(s, 'G', 'F')).toBe(false)
  })
  it('itemsInFolder skips archived items', () => {
    const t = makeSnapshot({
      items: [item('i1', 'A'), item('i2', 'B', null, { archivedAt: '2026-02-01T00:00:00Z', archiveId: 'x' })],
    })
    expect(itemsInFolder(t, null).map((i) => i.id)).toEqual(['i1'])
  })
})
