import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clampTreeWidth,
  loadTreeWidth,
  saveTreeWidth,
  TREE_WIDTH_DEFAULT,
  TREE_WIDTH_MIN,
  treeWidthMax,
} from '../app/lib/tree-width'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
}
const throwing = (): Storage => {
  const boom = (): never => {
    throw new Error('blocked')
  }
  return { length: 0, clear: boom, getItem: boom, key: boom, removeItem: boom, setItem: boom }
}

afterEach(() => vi.unstubAllGlobals())

describe('clampTreeWidth', () => {
  it('keeps the width between 200 px and half the window', () => {
    expect(clampTreeWidth(100, 1280)).toBe(TREE_WIDTH_MIN)
    expect(clampTreeWidth(400, 1280)).toBe(400)
    expect(clampTreeWidth(900, 1280)).toBe(640)
    expect(treeWidthMax(1280)).toBe(640)
  })

  it('never goes below the minimum in a narrow window, rounds and survives garbage', () => {
    expect(clampTreeWidth(300, 300)).toBe(TREE_WIDTH_MIN)
    expect(clampTreeWidth(263.6, 1280)).toBe(264)
    expect(clampTreeWidth(Number.NaN, 1280)).toBe(TREE_WIDTH_DEFAULT)
  })
})

describe('antresol.treeWidth', () => {
  it('saves and reads the width in pixels, and forgets it on null', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    expect(loadTreeWidth()).toBeNull()
    saveTreeWidth(312.4)
    expect(localStorage.getItem('antresol.treeWidth')).toBe('312')
    expect(loadTreeWidth()).toBe(312)
    saveTreeWidth(null)
    expect(loadTreeWidth()).toBeNull()
  })

  it('ignores a value that is not a width', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    localStorage.setItem('antresol.treeWidth', 'wide')
    expect(loadTreeWidth()).toBeNull()
    localStorage.setItem('antresol.treeWidth', '-5')
    expect(loadTreeWidth()).toBeNull()
  })

  it('does not throw when the storage does', () => {
    vi.stubGlobal('localStorage', throwing())
    expect(loadTreeWidth()).toBeNull()
    expect(() => saveTreeWidth(300)).not.toThrow()
    expect(() => saveTreeWidth(null)).not.toThrow()
  })
})
