import { newId, StorageError, type Id, type Intake, type IntakeDraftContent, type SaveIntakeDraftResult } from '@antresol/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDeviceDb, type DeviceDb } from '../app/lib/device-db'
import {
  createIntakeCommitSender,
  createIntakeDraftSync,
  DRAFT_SYNC_DELAY_MS,
  type LocalIntakeDraft,
} from '../app/lib/intake-drafts'

const SRC = 's1'
const INV = 'inv-1'

type Save = (
  id: Id,
  header: LocalIntakeDraft['header'],
  content: IntakeDraftContent,
  baseDraftRev: string | null,
  force?: boolean,
) => Promise<SaveIntakeDraftResult>

/** A save that answers like the database: every write gets a new draftRev. */
function savingDb() {
  let n = 0
  return vi.fn<Save>(async () => ({ saved: true, draftRev: `rev-${++n}`, intakesRev: `irev-${n}` }))
}

function setup(save: ReturnType<typeof vi.fn<Save>> = savingDb(), db: DeviceDb = createMemoryDeviceDb()) {
  let inventoryId: string | null = INV
  const sync = createIntakeDraftSync({ db, save, sourceId: () => SRC, inventoryId: () => inventoryId })
  return {
    db,
    save,
    sync,
    switchInventory: (id: string | null) => {
      inventoryId = id
    },
  }
}

const shop = (name: string) => (d: LocalIntakeDraft): LocalIntakeDraft => ({ ...d, header: { ...d.header, shop: name } })

const theirs = (id: Id, shopName: string, draftRev: string): Intake => ({
  id,
  inventoryId: INV,
  status: 'draft',
  header: { shop: shopName, orderNumber: null, purchasedOn: '2026-11-12', note: null },
  draft: { newItems: [], lines: [] },
  lines: null,
  draftRev,
  createdAt: '2026-11-12T10:00:00Z',
  createdBy: 'Phone',
  updatedAt: '2026-11-12T10:05:00Z',
  updatedBy: 'Phone',
  committedAt: null,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-13T09:00:00'))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('intake draft sync', () => {
  it('a new draft starts empty, dated today, and is not on the device until edited', async () => {
    const { sync, db } = setup()
    const id = newId()
    const fresh = await sync.load(id, null)
    expect(fresh).toEqual({
      inventoryId: INV,
      header: { shop: null, orderNumber: null, purchasedOn: '2026-11-13', note: null },
      content: { newItems: [], lines: [] },
      baseDraftRev: null,
      dirty: false,
      changedElsewhere: null,
    })
    expect(await db.getIntakeDraft(SRC, id)).toBeNull()
    const edited = await sync.edit(id, shop('LCSC'))
    expect(edited.dirty).toBe(true)
    expect((await db.getIntakeDraft(SRC, id))?.header.shop).toBe('LCSC')
  })

  it('five edits within the pause make one database write, sent after the pause', async () => {
    const { sync, save, db } = setup()
    const id = newId()
    await sync.load(id, null)
    for (const name of ['L', 'LC', 'LCS', 'LCSC', 'LCSC!']) {
      await sync.edit(id, shop(name))
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DELAY_MS)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0]![0]).toBe(id)
    expect(save.mock.calls[0]![1].shop).toBe('LCSC!')
    expect(save.mock.calls[0]![3]).toBeNull()
    expect(await db.getIntakeDraft(SRC, id)).toMatchObject({ dirty: false, baseDraftRev: 'rev-1' })
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SYNC_DELAY_MS)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('flush sends at once, and the next write goes from the draftRev it got', async () => {
    const { sync, save } = setup()
    const id = newId()
    await sync.load(id, null)
    await sync.edit(id, shop('LCSC'))
    await sync.flush(id)
    expect(save).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DELAY_MS)
    expect(save).toHaveBeenCalledTimes(1)
    await sync.edit(id, shop('Mouser'))
    await sync.flush(id)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![3]).toBe('rev-1')
  })

  it('an edit made while a write is on its way stays dirty and goes out next', async () => {
    let answer!: () => void
    const save = savingDb()
    const first = save.getMockImplementation()!
    save.mockImplementationOnce(async (...args) => {
      await new Promise<void>((r) => (answer = r))
      return first(...args)
    })
    const { sync, db } = setup(save)
    const id = newId()
    await sync.load(id, null)
    await sync.edit(id, shop('A'))
    const flushing = sync.flush(id)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await sync.edit(id, shop('B'))
    answer()
    await flushing
    expect(await db.getIntakeDraft(SRC, id)).toMatchObject({ dirty: true, baseDraftRev: 'rev-1', header: { shop: 'B' } })
    await sync.flush(id)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![1].shop).toBe('B')
    expect(save.mock.calls[1]![3]).toBe('rev-1')
    expect((await db.getIntakeDraft(SRC, id))?.dirty).toBe(false)
  })

  it('the tab was closed before the write: a new sync on the same device sends the dirty copy on load and on flush', async () => {
    const db = createMemoryDeviceDb()
    const before = setup(vi.fn<Save>(), db)
    const [a, b] = [newId(), newId()]
    await before.sync.load(a, null)
    await before.sync.edit(a, shop('Opened again'))
    await before.sync.load(b, null)
    await before.sync.edit(b, shop('Never opened'))
    expect(before.save).not.toHaveBeenCalled()

    const after = setup(savingDb(), db)
    const loaded = await after.sync.load(a, null)
    expect(loaded).toMatchObject({ dirty: true, header: { shop: 'Opened again' } })
    await after.sync.flush(a)
    expect(after.save.mock.calls.map((c) => [c[0], c[1].shop])).toEqual([[a, 'Opened again']])
    await after.sync.flush()
    expect(after.save.mock.calls.map((c) => [c[0], c[1].shop])).toEqual([
      [a, 'Opened again'],
      [b, 'Never opened'],
    ])
    expect((await db.getIntakeDraft(SRC, b))?.dirty).toBe(false)
  })

  it('a database row replaces a copy with no unsaved edits; a dirty copy wins over it', async () => {
    const { sync, db } = setup()
    const id = newId()
    await sync.load(id, theirs(id, 'Old', 'r1'))
    expect(await db.getIntakeDraft(SRC, id)).toMatchObject({ dirty: false, baseDraftRev: 'r1', header: { shop: 'Old' } })
    const newer = await sync.load(id, theirs(id, 'Newer', 'r2'))
    expect(newer).toMatchObject({ dirty: false, baseDraftRev: 'r2', header: { shop: 'Newer' } })
    await sync.edit(id, shop('Mine'))
    const kept = await sync.load(id, theirs(id, 'Newer', 'r2'))
    expect(kept).toMatchObject({ dirty: true, header: { shop: 'Mine' }, changedElsewhere: null })
  })

  it('a dirty copy whose database row changed since is not overwritten: the change elsewhere is shown', async () => {
    const { sync, db } = setup(vi.fn<Save>())
    const id = newId()
    await sync.load(id, theirs(id, 'Old', 'r1'))
    await sync.edit(id, shop('Mine'))
    const loaded = await sync.load(id, theirs(id, 'Theirs', 'r2'))
    expect(loaded.header.shop).toBe('Mine')
    expect(loaded.changedElsewhere?.draftRev).toBe('r2')
    expect((await db.getIntakeDraft(SRC, id))?.changedElsewhere?.header.shop).toBe('Theirs')
  })

  it('changed elsewhere: the edit stays, no automatic resend; keepMine writes over with force, takeTheirs takes their copy', async () => {
    const id = newId()
    const save = savingDb()
    save.mockResolvedValueOnce({ saved: false, reason: 'changed', current: theirs(id, 'Theirs', 'r9') })
    const { sync, db } = setup(save)
    await sync.load(id, theirs(id, 'Old', 'r1'))
    await sync.edit(id, shop('Mine'))
    await sync.flush(id)
    const copy = (await db.getIntakeDraft(SRC, id))!
    expect(copy).toMatchObject({ dirty: true, header: { shop: 'Mine' }, baseDraftRev: 'r1' })
    expect(copy.changedElsewhere?.header.shop).toBe('Theirs')
    await sync.edit(id, shop('Mine 2'))
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SYNC_DELAY_MS)
    await sync.flush()
    expect(save).toHaveBeenCalledTimes(1)

    await sync.resolveConflict(id, 'keepMine')
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]![1].shop).toBe('Mine 2')
    expect(save.mock.calls[1]![4]).toBe(true)
    expect(await db.getIntakeDraft(SRC, id)).toMatchObject({ dirty: false, changedElsewhere: null, baseDraftRev: 'rev-1' })
  })

  it('takeTheirs replaces the copy with the one from the database, nothing sent', async () => {
    const id = newId()
    const save = vi.fn<Save>(async () => ({ saved: false, reason: 'changed', current: theirs(id, 'Theirs', 'r9') }))
    const { sync, db } = setup(save)
    await sync.load(id, theirs(id, 'Old', 'r1'))
    await sync.edit(id, shop('Mine'))
    await sync.flush(id)
    await sync.resolveConflict(id, 'takeTheirs')
    expect(save).toHaveBeenCalledTimes(1)
    expect(await db.getIntakeDraft(SRC, id)).toEqual({
      inventoryId: INV,
      header: theirs(id, 'Theirs', 'r9').header,
      content: { newItems: [], lines: [] },
      baseDraftRev: 'r9',
      dirty: false,
      changedElsewhere: null,
    })
  })

  it('offline: the copy stays dirty, no error, no retry by itself; the next flush sends it', async () => {
    const save = savingDb()
    save.mockRejectedValueOnce(new StorageError('unavailable'))
    const { sync, db } = setup(save)
    const id = newId()
    await sync.load(id, null)
    await sync.edit(id, shop('Offline'))
    await expect(sync.flush(id)).resolves.toBeUndefined()
    expect((await db.getIntakeDraft(SRC, id))?.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SYNC_DELAY_MS)
    expect(save).toHaveBeenCalledTimes(1)
    await sync.flush()
    expect(save).toHaveBeenCalledTimes(2)
    expect((await db.getIntakeDraft(SRC, id))?.dirty).toBe(false)
  })

  it('a draft of another inventory waits on the device until its inventory is current again', async () => {
    const { sync, save, db, switchInventory } = setup()
    const id = newId()
    await sync.load(id, null)
    await sync.edit(id, shop('Inv 1'))
    switchInventory('inv-2')
    await sync.flush()
    expect(save).not.toHaveBeenCalled()
    expect((await db.getIntakeDraft(SRC, id))?.dirty).toBe(true)
    switchInventory(INV)
    await sync.flush()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a draft committed elsewhere keeps the unsaved edits, marked with the committed row; keepMine is refused, takeTheirs drops them', async () => {
    const id = newId()
    const committed: Intake = { ...theirs(id, 'Theirs', 'r9'), status: 'committed', draft: null, lines: [] }
    const save = vi.fn<Save>(async () => ({ saved: false, reason: 'committed' }))
    const db = createMemoryDeviceDb()
    const sync = createIntakeDraftSync({ db, save, sourceId: () => SRC, inventoryId: () => INV, findIntake: async () => committed })
    await sync.load(id, theirs(id, 'Old', 'r1'))
    await sync.edit(id, shop('Mine'))
    await sync.flush(id)
    const copy = (await db.getIntakeDraft(SRC, id))!
    expect(copy).toMatchObject({ dirty: true, header: { shop: 'Mine' } })
    expect(copy.changedElsewhere).toEqual(committed)
    // Never sent again by itself.
    await sync.edit(id, shop('Mine 2'))
    await vi.advanceTimersByTimeAsync(10 * DRAFT_SYNC_DELAY_MS)
    await sync.flush()
    expect(save).toHaveBeenCalledTimes(1)
    await expect(sync.resolveConflict(id, 'keepMine')).rejects.toMatchObject({ name: 'StorageError', code: 'conflict' })
    expect(save).toHaveBeenCalledTimes(1)
    expect(await db.getIntakeDraft(SRC, id)).toMatchObject({ dirty: true, header: { shop: 'Mine 2' }, changedElsewhere: committed })
    await sync.resolveConflict(id, 'takeTheirs')
    expect(await db.getIntakeDraft(SRC, id)).toBeNull()
  })

  it('without a row to read, the mark is a committed row made from the copy', async () => {
    const save = vi.fn<Save>(async () => ({ saved: false, reason: 'committed' }))
    const { sync, db } = setup(save)
    const id = newId()
    await sync.load(id, theirs(id, 'Old', 'r1'))
    await sync.edit(id, shop('Mine'))
    await sync.flush(id)
    expect((await db.getIntakeDraft(SRC, id))?.changedElsewhere).toMatchObject({ id, status: 'committed', header: { shop: 'Mine' } })
  })

  it('load of a committed row: a dirty copy is kept and marked, a clean one is dropped and the load rejects', async () => {
    const { sync, db } = setup(vi.fn<Save>())
    const [dirty, clean] = [newId(), newId()]
    const committedRow = (id: Id): Intake => ({ ...theirs(id, 'Theirs', 'r9'), status: 'committed', draft: null, lines: [] })
    await sync.load(dirty, theirs(dirty, 'Old', 'r1'))
    await sync.edit(dirty, shop('Mine'))
    const marked = await sync.load(dirty, committedRow(dirty))
    expect(marked).toMatchObject({ dirty: true, header: { shop: 'Mine' }, changedElsewhere: { status: 'committed' } })
    expect((await db.getIntakeDraft(SRC, dirty))?.changedElsewhere?.status).toBe('committed')
    await sync.load(clean, theirs(clean, 'Old', 'r1'))
    await expect(sync.load(clean, committedRow(clean))).rejects.toMatchObject({ name: 'StorageError', code: 'not_found' })
    expect(await db.getIntakeDraft(SRC, clean)).toBeNull()
  })

  it('the device storage failing during a timed write: no unhandled rejection, the copy stays dirty, flush resolves', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown): void => {
      unhandled.push(e)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const { sync, save, db } = setup()
      const id = newId()
      await sync.load(id, null)
      await sync.edit(id, shop('LCSC'))
      const put = db.putIntakeDraft.bind(db)
      const get = db.getIntakeDraft.bind(db)
      db.putIntakeDraft = async () => {
        throw new DOMException('quota exceeded', 'QuotaExceededError')
      }
      await vi.advanceTimersByTimeAsync(DRAFT_SYNC_DELAY_MS)
      expect(save).toHaveBeenCalledTimes(1)
      expect((await db.getIntakeDraft(SRC, id))?.dirty).toBe(true)
      db.getIntakeDraft = async () => {
        throw new DOMException('gone', 'UnknownError')
      }
      await expect(sync.flush(id)).resolves.toBeUndefined()
      await expect(sync.flush()).resolves.toBeUndefined()
      await expect(sync.load(id, null)).rejects.toBeInstanceOf(DOMException)
      db.putIntakeDraft = put
      db.getIntakeDraft = get
      // Back: sent again from the base it had (the answer it could not keep makes the database row look changed).
      await sync.flush(id)
      expect(save).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('intake commit sender', () => {
  it('an unknown outcome freezes until a retry; a refusal does not', async () => {
    const commit = vi.fn<(id: Id) => Promise<{ ok: true }>>()
    const sender = createIntakeCommitSender(commit)
    commit.mockRejectedValueOnce(new StorageError('conflict'))
    expect(await sender.send('a')).toBeNull()
    expect(sender.phase.value).toBe('editing')
    commit.mockRejectedValueOnce(new StorageError('unavailable'))
    expect(await sender.send('a')).toBeNull()
    expect(sender.phase.value).toBe('unconfirmed')
    expect(sender.frozen.value).toBe(true)
    commit.mockRejectedValueOnce(new StorageError('failed'))
    expect(await sender.retry()).toBeNull()
    expect(sender.phase.value).toBe('unconfirmed')
    commit.mockResolvedValueOnce({ ok: true })
    expect(await sender.retry()).toEqual({ ok: true })
    expect(sender.phase.value).toBe('editing')
    expect(sender.error.value).toBeNull()
    expect(commit.mock.calls.map((c) => c[0])).toEqual(['a', 'a', 'a', 'a'])
  })
})
