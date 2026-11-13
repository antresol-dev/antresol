import { emptyIntakeDraft, StorageError, type Id, type Intake, type IntakeDraftContent, type IntakeHeader } from '@antresol/core'
import type { DeviceDb } from './device-db'
import { createUnconfirmedCore, isUnknownOutcome, type Attempt, type UnconfirmedCore } from './unconfirmed'
import type { Workspace } from './workspace-types'

/**
 * Intake drafts on this device (spec 2026-11-13 intakes §4). Every edit is written to the device at once, so it
 * survives a reload or a closed tab; the database gets the whole draft in one write after a pause of
 * DRAFT_SYNC_DELAY_MS since the last edit, and at once on flush (leaving the screen, the app hidden, back online,
 * before a commit). A draft changed in the database meanwhile (another device) is never written over silently: the
 * copy keeps its edits and shows what the database holds (`changedElsewhere`) until resolveConflict.
 */

export interface LocalIntakeDraft {
  /** The inventory the draft belongs to: it is sent only while that inventory is the current one. */
  inventoryId: Id
  header: IntakeHeader
  content: IntakeDraftContent
  /** The database row's draftRev this copy was last loaded from or saved as; null: not in the database yet. */
  baseDraftRev: string | null
  /** Edits the database does not have yet. */
  dirty: boolean
  /** The database row as another device saved it while this copy had unsaved edits; nothing is sent until resolved.
   *  A committed row (committed on another device): only takeTheirs is possible, which drops the copy. */
  changedElsewhere: Intake | null
}

export const DRAFT_SYNC_DELAY_MS = 3_000

export interface IntakeDraftSync {
  /** Writes the device copy at once and schedules the database write. The draft must have been loaded. */
  edit(id: Id, change: (d: LocalIntakeDraft) => LocalIntakeDraft): Promise<LocalIntakeDraft>
  /** Sends the draft (every draft of the current source without `id`) now if it has unsaved edits. Never rejects: a
   *  write that fails leaves the copy dirty for the next flush. */
  flush(id?: Id): Promise<void>
  /** keepMine: the copy is written over the database row (force); takeTheirs: the row replaces the copy. Against a row
   *  committed elsewhere, takeTheirs drops the copy and keepMine rejects with `conflict`, the copy left as it is. */
  resolveConflict(id: Id, choice: 'keepMine' | 'takeTheirs'): Promise<void>
  /** The device copy wins while it is dirty (sent now); otherwise the database row, kept on the device as what was
   *  last seen. Null and no copy: a new empty draft, kept in memory until its first edit. A committed row: a dirty copy
   *  is kept and marked with it (changedElsewhere); a clean one is dropped and the call rejects with `not_found`.
   *  `create: false`: an id with no row, no copy and no new draft rejects with `not_found` instead of starting one. */
  load(id: Id, fromDatabase: Intake | null, options?: { create?: boolean }): Promise<LocalIntakeDraft>
  /** The device copy as it is now; null: none. */
  peek(id: Id): Promise<LocalIntakeDraft | null>
  /** Every device copy of the current source (drafts not yet in the database among them); never rejects. */
  peekAll(): Promise<{ id: Id; draft: LocalIntakeDraft }[]>
  /** Drops the copy and any pending write (a draft deleted or committed). */
  forget(id: Id): Promise<void>
}

/** IndexedDB cannot clone reactive proxies; drafts are plain JSON. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const fromIntake = (intake: Intake): LocalIntakeDraft => ({
  inventoryId: intake.inventoryId,
  header: intake.header,
  content: intake.draft ?? emptyIntakeDraft(),
  baseDraftRev: intake.draftRev,
  dirty: false,
  changedElsewhere: null,
})

/** YYYY-MM-DD of the device's own day. */
function localDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function createIntakeDraftSync(deps: {
  db: DeviceDb
  save: Workspace['saveIntakeDraft']
  sourceId: () => string | null
  /** The current inventory: only its drafts are sent (the save writes into it). */
  inventoryId: () => Id | null
  /** The intake's database row, to mark a copy whose draft was committed elsewhere; without it (or when it fails) the
   *  mark is a committed row made from the copy's header. */
  findIntake?: (id: Id) => Promise<Intake | null>
  now?: () => number
}): IntakeDraftSync {
  const { db, save } = deps
  const now = deps.now ?? (() => Date.now())
  /** New drafts not on the device yet (no edit so far), by source and id. */
  const fresh = new Map<string, LocalIntakeDraft>()
  const timers = new Map<Id, ReturnType<typeof setTimeout>>()
  /** Edits made in this session per draft: a write answered after one keeps the copy dirty. */
  const edits = new Map<Id, number>()
  /** Per draft: reads and writes of its device copy, one at a time (short, never across the network). */
  const copyLocks = new Map<Id, Promise<unknown>>()
  /** Per draft: database writes, one at a time. */
  const sends = new Map<Id, Promise<unknown>>()

  const freshKey = (sourceId: string, id: Id): string => `${sourceId}:${id}`

  function serial<T>(locks: Map<Id, Promise<unknown>>, id: Id, job: () => Promise<T>): Promise<T> {
    const run = (locks.get(id) ?? Promise.resolve()).then(job, job)
    const settled = run.catch(() => {})
    locks.set(id, settled)
    void settled.then(() => {
      if (locks.get(id) === settled) locks.delete(id)
    })
    return run
  }
  const withCopy = <T>(id: Id, job: () => Promise<T>): Promise<T> => serial(copyLocks, id, job)

  function cancel(id: Id): void {
    clearTimeout(timers.get(id))
    timers.delete(id)
  }

  function schedule(id: Id): void {
    cancel(id)
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        void send(id, false)
      }, DRAFT_SYNC_DELAY_MS),
    )
  }

  /** The row a copy is marked with when its draft was committed elsewhere (see deps.findIntake). */
  async function committedRow(id: Id, copy: LocalIntakeDraft): Promise<Intake> {
    const found = await deps.findIntake?.(id).catch(() => null)
    if (found?.status === 'committed') return found
    return {
      id,
      inventoryId: copy.inventoryId,
      status: 'committed',
      header: copy.header,
      draft: null,
      lines: null,
      draftRev: '',
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
      committedAt: null,
    }
  }

  const isCommitted = (copy: LocalIntakeDraft): boolean => copy.changedElsewhere?.status === 'committed'

  async function put(sourceId: string, id: Id, draft: LocalIntakeDraft): Promise<void> {
    fresh.delete(freshKey(sourceId, id))
    await db.putIntakeDraft(sourceId, id, plain(draft))
  }

  /** One database write of the copy if it has unsaved edits and nothing blocks it. Never rejects: a failure, of the
   *  database or of the device's own storage, leaves the copy as it was (dirty) for a later flush. */
  function send(id: Id, force: boolean): Promise<void> {
    return serial(sends, id, () => sendNow(id, force)).catch(() => {})
  }

  async function sendNow(id: Id, force: boolean): Promise<void> {
    const sourceId = deps.sourceId()
    if (sourceId === null) return
    const sent = await withCopy(id, () => db.getIntakeDraft(sourceId, id))
    if (!sent || !sent.dirty || (sent.changedElsewhere && !force)) return
    if (deps.inventoryId() !== sent.inventoryId) return
    const editsBefore = edits.get(id) ?? 0
    let result: Awaited<ReturnType<typeof save>>
    try {
      result = await save(id, sent.header, sent.content, sent.baseDraftRev, force)
    } catch {
      // Offline or refused: the copy stays dirty and goes out with the next flush (the app calls one when back online).
      return
    }
    // Committed on another device: nothing can be saved into it any more. Read before the copy is locked (a network
    // call); the edits stay, marked with it, until the person discards them (takeTheirs).
    const committed = !result.saved && result.reason === 'committed' ? await committedRow(id, sent) : null
    await withCopy(id, async () => {
      const copy = await db.getIntakeDraft(sourceId, id)
      if (!copy) return
      if (result.saved) {
        const editedSince = (edits.get(id) ?? 0) !== editsBefore
        await put(sourceId, id, { ...copy, baseDraftRev: result.draftRev, changedElsewhere: null, dirty: editedSince })
        if (editedSince && !timers.has(id)) schedule(id)
      } else if (result.reason === 'changed') {
        await put(sourceId, id, { ...copy, changedElsewhere: result.current })
      } else {
        cancel(id)
        await put(sourceId, id, { ...copy, changedElsewhere: committed })
      }
    })
  }

  async function edit(id: Id, change: (d: LocalIntakeDraft) => LocalIntakeDraft): Promise<LocalIntakeDraft> {
    const sourceId = deps.sourceId()
    if (sourceId === null) throw new StorageError('not_found')
    const next = await withCopy(id, async () => {
      const current = (await db.getIntakeDraft(sourceId, id)) ?? fresh.get(freshKey(sourceId, id))
      if (!current) throw new Error(`intake draft ${id} is not loaded`)
      const changed: LocalIntakeDraft = { ...change(current), dirty: true }
      edits.set(id, (edits.get(id) ?? 0) + 1)
      await put(sourceId, id, changed)
      return changed
    })
    if (!next.changedElsewhere) schedule(id)
    return next
  }

  async function flush(id?: Id): Promise<void> {
    if (id !== undefined) {
      cancel(id)
      await send(id, false)
      return
    }
    const sourceId = deps.sourceId()
    if (sourceId === null) return
    const ids = new Set(timers.keys())
    for (const { id: draftId, draft } of await db.listIntakeDrafts(sourceId).catch(() => [])) {
      if (draft.dirty) ids.add(draftId)
    }
    for (const draftId of ids) {
      cancel(draftId)
      await send(draftId, false)
    }
  }

  async function resolveConflict(id: Id, choice: 'keepMine' | 'takeTheirs'): Promise<void> {
    const sourceId = deps.sourceId()
    if (sourceId === null) return
    const resolved = await withCopy(id, async () => {
      const copy = await db.getIntakeDraft(sourceId, id)
      const theirs = copy?.changedElsewhere
      if (!copy || !theirs) return false
      if (theirs.status === 'committed') {
        if (choice === 'keepMine') throw new StorageError('conflict', `intake ${id} was committed on another device`)
        await db.deleteIntakeDraft(sourceId, id)
        return false
      }
      // keepMine: from their revision on; should the forced write fail, a later plain one still sees a third version.
      await put(
        sourceId,
        id,
        choice === 'takeTheirs' ? fromIntake(theirs) : { ...copy, baseDraftRev: theirs.draftRev, changedElsewhere: null, dirty: true },
      )
      return true
    })
    if (!resolved) return
    cancel(id)
    if (choice === 'keepMine') await send(id, true)
  }

  async function load(id: Id, fromDatabase: Intake | null, options: { create?: boolean } = {}): Promise<LocalIntakeDraft> {
    const sourceId = deps.sourceId()
    if (sourceId === null) throw new StorageError('not_found')
    const loaded = await withCopy(id, async () => {
      const copy = await db.getIntakeDraft(sourceId, id)
      if (fromDatabase?.status === 'committed') {
        if (!copy?.dirty) {
          fresh.delete(freshKey(sourceId, id))
          if (copy) await db.deleteIntakeDraft(sourceId, id)
          return null
        }
        const marked = { ...copy, changedElsewhere: fromDatabase }
        await put(sourceId, id, marked)
        return marked
      }
      if (copy && isCommitted(copy)) return copy
      if (copy?.dirty) {
        const known = [copy.baseDraftRev, copy.changedElsewhere?.draftRev]
        if (fromDatabase && !known.includes(fromDatabase.draftRev)) {
          const shown = { ...copy, changedElsewhere: fromDatabase }
          await put(sourceId, id, shown)
          return shown
        }
        return copy
      }
      if (fromDatabase) {
        const row = fromIntake(fromDatabase)
        await put(sourceId, id, row)
        return row
      }
      if (copy) return copy
      const key = freshKey(sourceId, id)
      const known = fresh.get(key)
      if (known) return known
      const inventoryId = deps.inventoryId()
      if (inventoryId === null || options.create === false) throw new StorageError('not_found', `intake ${id} is unknown`)
      const created: LocalIntakeDraft = {
        inventoryId,
        header: { shop: null, orderNumber: null, purchasedOn: localDay(now()), note: null },
        content: emptyIntakeDraft(),
        baseDraftRev: null,
        dirty: false,
        changedElsewhere: null,
      }
      fresh.set(key, created)
      return created
    })
    if (!loaded) {
      cancel(id)
      throw new StorageError('not_found', `intake ${id} is committed`)
    }
    // Left dirty by a closed tab or a failed write: sent now.
    if (loaded.dirty && !loaded.changedElsewhere) void send(id, false)
    return loaded
  }

  async function peek(id: Id): Promise<LocalIntakeDraft | null> {
    const sourceId = deps.sourceId()
    if (sourceId === null) return null
    return withCopy(id, () => db.getIntakeDraft(sourceId, id))
  }

  async function peekAll(): Promise<{ id: Id; draft: LocalIntakeDraft }[]> {
    const sourceId = deps.sourceId()
    if (sourceId === null) return []
    return db.listIntakeDrafts(sourceId).catch(() => [])
  }

  async function forget(id: Id): Promise<void> {
    cancel(id)
    const sourceId = deps.sourceId()
    if (sourceId === null) return
    fresh.delete(freshKey(sourceId, id))
    // A write on its way lands first: the copy is not put back after this.
    await sends.get(id)
    await withCopy(id, () => db.deleteIntakeDraft(sourceId, id))
  }

  return { edit, flush, resolveConflict, load, peek, peekAll, forget }
}

export type CommitIntakeResult = Awaited<ReturnType<Workspace['commitIntake']>>

export interface IntakeCommitSender extends Omit<UnconfirmedCore<Id, CommitIntakeResult>, 'send' | 'retry'> {
  /** Commits; null when it failed (see `error`). While unconfirmed it retries instead. */
  send(id: Id): Promise<CommitIntakeResult | null>
  /** Commits the unconfirmed intake again. Safe: a commit that landed is found committed and nothing more is written. */
  retry(): Promise<CommitIntakeResult | null>
}

/**
 * The commit of an intake on the same state machine as a form's write (createUnconfirmedCore): after an unknown outcome
 * the draft freezes until a retry (any failure of a retry keeps it frozen) or a reset.
 */
export function createIntakeCommitSender(commit: (id: Id) => Promise<CommitIntakeResult>): IntakeCommitSender {
  const core = createUnconfirmedCore<Id, CommitIntakeResult>(commit, { freezesOn: (_id, e) => isUnknownOutcome(e) })
  const resultOf = (a: Attempt<CommitIntakeResult>): CommitIntakeResult | null => (a.outcome === 'saved' ? (a.result ?? null) : null)
  return {
    ...core,
    send: async (id) => resultOf(await core.send(id)),
    retry: async () => resultOf(await core.retry()),
  }
}
