import type { Command } from '@graymatter/core'
import { describe, expect, it, vi } from 'vitest'
import { archiveAtOnce, createUndo, UNDO_MIN_MS, type KeyLike, type UndoDeps } from '../app/lib/undo'

function setup() {
  const applied: Command[] = []
  const shown: { label: string; duration: number; onAction(): void; onGone(): void }[] = []
  const dismissed: (string | number)[] = []
  const deps: UndoDeps = {
    show: (label, o) => {
      shown.push({ label, duration: o.duration, onAction: o.onAction, onGone: o.onGone })
      return shown.length
    },
    dismiss: (id) => void dismissed.push(id),
    apply: async (c) => void applied.push(c),
    actionLabel: () => 'Undo',
    onError: vi.fn(),
  }
  const undo = createUndo(deps)
  const key = (over: Partial<KeyLike> = {}): KeyLike => ({
    key: 'z', ctrlKey: true, metaKey: false, shiftKey: false, inField: false, preventDefault: vi.fn(), ...over,
  })
  return { applied, shown, dismissed, undo, key }
}

describe('archive at once', () => {
  it('archives without asking, then Undo restores with the same archiveId', async () => {
    const t = setup()
    await archiveAtOnce(async (c) => void t.applied.push(c), t.undo.undoToast, 'item', 'i1', '“NE555” archived')
    expect(t.applied).toHaveLength(1)
    expect(t.applied[0]).toMatchObject({ type: 'archive', target: 'item', id: 'i1' })
    expect(t.shown[0]!.label).toBe('“NE555” archived')
    t.shown[0]!.onAction()
    const archiveId = (t.applied[0] as { archiveId: string }).archiveId
    expect(t.applied[1]).toEqual({ type: 'restore', archiveId })
  })
})

describe('undo toast', () => {
  it('stays at least 6 s, whatever is asked', () => {
    const t = setup()
    t.undo.undoToast('a', { type: 'restore', archiveId: 'x' }, { minMs: 1000 })
    t.undo.undoToast('b', { type: 'restore', archiveId: 'y' }, { minMs: 9000 })
    expect(t.shown.map((s) => s.duration)).toEqual([UNDO_MIN_MS, 9000])
  })

  it('Ctrl/Cmd+Z undoes the newest visible toast, once', () => {
    const t = setup()
    t.undo.undoToast('a', { type: 'restore', archiveId: 'x' })
    t.undo.undoToast('b', { type: 'restore', archiveId: 'y' })
    expect(t.undo.onKey(t.key({ ctrlKey: false, metaKey: true }))).toBe(true)
    expect(t.applied).toEqual([{ type: 'restore', archiveId: 'y' }])
    expect(t.dismissed).toEqual([2])
    t.shown[1]!.onGone() // the dismissal closing it must not undo again
    expect(t.undo.onKey(t.key())).toBe(true)
    expect(t.applied).toEqual([
      { type: 'restore', archiveId: 'y' },
      { type: 'restore', archiveId: 'x' },
    ])
  })

  it('Ctrl+Z after the toast is gone does nothing', () => {
    const t = setup()
    t.undo.undoToast('a', { type: 'restore', archiveId: 'x' })
    t.shown[0]!.onGone()
    const k = t.key()
    expect(t.undo.onKey(k)).toBe(false)
    expect(k.preventDefault).not.toHaveBeenCalled()
    expect(t.applied).toEqual([])
  })

  it('leaves Ctrl+Z to a text field, and ignores other keys', () => {
    const t = setup()
    t.undo.undoToast('a', { type: 'restore', archiveId: 'x' })
    expect(t.undo.onKey(t.key({ inField: true }))).toBe(false)
    expect(t.undo.onKey(t.key({ key: 'y' }))).toBe(false)
    expect(t.undo.onKey(t.key({ shiftKey: true }))).toBe(false)
    expect(t.applied).toEqual([])
  })

  it('Undo clicked after Ctrl+Z does not restore twice', () => {
    const t = setup()
    t.undo.undoToast('a', { type: 'restore', archiveId: 'x' })
    t.undo.onKey(t.key())
    t.shown[0]!.onAction()
    expect(t.applied).toHaveLength(1)
  })
})
