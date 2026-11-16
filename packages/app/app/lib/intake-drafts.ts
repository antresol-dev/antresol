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
   *  last seen. A row older than the copy (a draftRev it has moved on from in this session: a list kept offline, or
   *  read before a save and answered after it) never replaces it or marks it changed; a row holding the copy's own
   *  content (a write whose answer was lost) is taken as saved. Null and no copy: a new empty draft, kept in memory
   *  until its first edit. A committed row: a dirty copy is kept and marked with it (changedElsewhere); a clean one is
   *  dropped and the call rejects with `not_found`.
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

/** JSON with every object's keys in one order: a draft as the device holds it and as the database's jsonb gives it back
 *  (keys reordered) compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
/** What a write sends of a draft, comparable with a row. */
const payloadOf = (d: { header: IntakeHeader; content: IntakeDraftContent }): string => canonical({ header: d.header, content: d.content })
const rowPayload = (row: Intake): string => canonical({ header: row.header, content: row.draft ?? emptyIntakeDraft() })

/** Writes whose answer was lost, remembered per draft: the newest few are enough. */
const UNANSWERED_KEPT = 5

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
  /** Per draft: the draftRevs its copy has moved on from in this session (saved over, or replaced by a newer row). A row
   *  holding one is older than the copy (a list kept from before the source went offline, or read before a save and
   *  answered after it) and never replaces the copy or marks it changed. A draftRev is never made twice. */
  const passed = new Map<Id, Set<string>>()
  /** Per draft: what writes whose answer was lost sent (payloadOf). Such a write may have landed: the database then
   *  holds one of them under a draftRev this copy does not know, which is this device's own write, not another's. */
  const unanswered = new Map<Id, string[]>()

  function moveOn(id: Id, from: string | null): void {
    if (from === null) return
    const set = passed.get(id) ?? new Set<string>()
    set.add(from)
    passed.set(id, set)
  }
  const hasPassed = (id: Id, draftRev: string): boolean => passed.get(id)?.has(draftRev) ?? false
  function rememberUnanswered(id: Id, payload: string): void {
    unanswered.set(id, [...(unanswered.get(id) ?? []).filter((p) => p !== payload), payload].slice(-UNANSWERED_KEPT))
  }
  /** The row holds a write of this device whose answer was lost. */
  const ownUnanswered = (id: Id, row: Intake): boolean => unanswered.get(id)?.includes(rowPayload(row)) ?? false

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
      created: null,
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
    const payload = payloadOf(sent)
    let result: Awaited<ReturnType<typeof save>>
    try {
      result = await save(id, sent.header, sent.content, sent.baseDraftRev, force)
    } catch {
      // Offline or refused: the copy stays dirty and goes out with the next flush (the app calls one when back online).
      // The write may have landed with its answer lost (a phone suspending the page mid-request): remembered, so the
      // database holding it is not taken for another device's save.
      rememberUnanswered(id, payload)
      return
    }
    // Refused as changed while the database holds this device's own write: this very content (an earlier write of it
    // landed with its answer lost), or a write whose answer was lost. Taken as saved under the database's draftRev; the
    // copy stays dirty (and goes out again at once) when the database holds an older write than this one.
    const landed: { draftRev: string; behind: boolean } | null = result.saved
      ? { draftRev: result.draftRev, behind: false }
      : result.reason === 'changed' && (rowPayload(result.current) === payload || ownUnanswered(id, result.current))
        ? { draftRev: result.current.draftRev, behind: rowPayload(result.current) !== payload }
        : null
    if (landed) unanswered.delete(id)
    // Committed on another device: nothing can be saved into it any more. Read before the copy is locked (a network
    // call); the edits stay, marked with it, until the person discards them (takeTheirs).
    const committed = !result.saved && result.reason === 'committed' ? await committedRow(id, sent) : null
    const again = await withCopy(id, async () => {
      const copy = await db.getIntakeDraft(sourceId, id)
      if (!copy) return false
      if (landed) {
        const editedSince = (edits.get(id) ?? 0) !== editsBefore
        moveOn(id, copy.baseDraftRev)
        await put(sourceId, id, { ...copy, baseDraftRev: landed.draftRev, changedElsewhere: null, dirty: editedSince || landed.behind })
        if (editedSince && !landed.behind && !timers.has(id)) schedule(id)
        return landed.behind
      }
      if (!result.saved && result.reason === 'changed') await put(sourceId, id, { ...copy, changedElsewhere: result.current })
      else {
        cancel(id)
        await put(sourceId, id, { ...copy, changedElsewhere: committed })
      }
      return false
    })
    // Still in this write's turn: the copy goes out from the draftRev its lost write made.
    if (again) await sendNow(id, false)
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
      moveOn(id, copy.baseDraftRev)
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
      // A row this copy has moved on from is older than it: the copy stays as it is.
      const newer =
        fromDatabase && (!copy || (fromDatabase.draftRev !== copy.baseDraftRev && !hasPassed(id, fromDatabase.draftRev))) ? fromDatabase : null
      if (copy?.dirty) {
        if (newer && (rowPayload(newer) === payloadOf(copy) || ownUnanswered(id, newer))) {
          // This device's own write, its answer lost (the page may have been reloaded since): saved under the row's
          // draftRev, still dirty only when the copy holds more than the row.
          unanswered.delete(id)
          moveOn(id, copy.baseDraftRev)
          const saved = { ...copy, baseDraftRev: newer.draftRev, changedElsewhere: null, dirty: rowPayload(newer) !== payloadOf(copy) }
          await put(sourceId, id, saved)
          return saved
        }
        if (newer && newer.draftRev !== copy.changedElsewhere?.draftRev) {
          const shown = { ...copy, changedElsewhere: newer }
          await put(sourceId, id, shown)
          return shown
        }
        return copy
      }
      if (copy && fromDatabase && !newer) return copy
      if (newer) {
        moveOn(id, copy?.baseDraftRev ?? null)
        const row = fromIntake(newer)
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
