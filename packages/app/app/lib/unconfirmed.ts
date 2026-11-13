import { DomainError, newId, StorageError, type Command, type Id } from '@antresol/core'
import { computed, readonly, ref, shallowRef, type ComputedRef, type Ref } from 'vue'

/** The source may or may not have taken the write: it did not answer in time, or the connection dropped (spec 4.7). The
 *  same command sent again is safe: the source skips the rows that already landed (`on conflict (id) do nothing`). */
export const isUnknownOutcome = (e: unknown): boolean => e instanceof StorageError && e.code === 'unavailable'

/** A refusal of a retry that the first attempt having landed explains: the stock it took is gone (use, move). Not proof:
 *  the form says the first attempt was probably saved, and to check the numbers. */
export function landedBefore(command: Command, e: unknown): boolean {
  return (
    e instanceof DomainError &&
    e.code === 'insufficient_stock' &&
    (command.type === 'stock.use' || command.type === 'stock.transfer')
  )
}

/** stock.set sets the stock to its target whatever it was: sent again with a fresh id it changes nothing more (a zero
 *  adjustment), so an edited count never needs the old id. Every other command adds or creates something. */
const isAbsolute = (command: Command): boolean => command.type === 'stock.set'

/** - editing: the fields are the form's;
 *  - sending: a write is on its way;
 *  - unconfirmed: the last write's outcome is unknown. The fields stay as they were sent: an edited command under the
 *    same ids would be skipped by the source if the first one landed, and new ids would write it twice if it did. Only
 *    a retry of the same command or closing the form (which renews its ids) moves on;
 *  - retrying: that retry is on its way (still frozen). */
export type SendPhase = 'editing' | 'sending' | 'unconfirmed' | 'retrying'
/** probablySaved: a retry was refused as landedBefore explains; the form closes and says so instead of an error. */
export type SendOutcome = 'saved' | 'probablySaved' | 'failed'

/** The freeze state of a write whose outcome may be unknown, shared by every sender (see createUnconfirmedCore). */
interface FreezeState {
  phase: Readonly<Ref<SendPhase>>
  /** A write is on its way (sending or retrying): the sheet stays open. */
  busy: ComputedRef<boolean>
  /** Unconfirmed or retrying: the fields are read-only; the form offers Retry and Close. */
  frozen: ComputedRef<boolean>
  /** The failure of the last attempt; null after a success. */
  error: Readonly<Ref<unknown>>
  /** Back to editing with nothing pending, for a form that opens again (it renews its ids itself). */
  reset(): void
}

/** What a send or retry came to; `result`: the write's own answer, when it was made and saved. */
export interface Attempt<R> {
  outcome: SendOutcome
  result?: R
}

export interface UnconfirmedCore<P, R> extends FreezeState {
  /** Sends a payload. While unconfirmed it sends the unconfirmed payload again instead (see retry). */
  send(payload: P): Promise<Attempt<R>>
  /** Sends the unconfirmed payload again, unchanged; saved without a write when `shows` says the copy holds it. Any
   *  failure but `landedBefore` keeps the form unconfirmed: the first attempt may still have landed. */
  retry(): Promise<Attempt<R>>
}

/**
 * The one state machine behind every write that freezes its form on an unknown outcome (spec 4.7): a first attempt
 * failing as `freezesOn` says leaves the payload pending and the form unconfirmed until a retry of the same payload or
 * a reset; any other failure returns to editing.
 */
export function createUnconfirmedCore<P, R>(
  attempt: (payload: P) => Promise<R>,
  policy: {
    freezesOn: (payload: P, e: unknown) => boolean
    landedBefore?: (payload: P, e: unknown) => boolean
    shows?: (payload: P) => boolean
  },
): UnconfirmedCore<P, R> {
  const phase = ref<SendPhase>('editing')
  const error = shallowRef<unknown>(null)
  /** The payload whose outcome is unknown. */
  let pending: { payload: P } | null = null

  function settle(): void {
    pending = null
    error.value = null
    phase.value = 'editing'
  }

  async function run(payload: P, retrying: boolean): Promise<Attempt<R>> {
    phase.value = retrying ? 'retrying' : 'sending'
    let result: R
    try {
      result = await attempt(payload)
    } catch (e) {
      error.value = e
      if (retrying && policy.landedBefore?.(payload, e)) {
        pending = null
        phase.value = 'editing'
        return { outcome: 'probablySaved' }
      }
      if (retrying || policy.freezesOn(payload, e)) {
        pending = { payload }
        phase.value = 'unconfirmed'
      } else {
        phase.value = 'editing'
      }
      return { outcome: 'failed' }
    }
    settle()
    return { outcome: 'saved', result }
  }

  async function retry(): Promise<Attempt<R>> {
    const held = pending
    if (!held || phase.value !== 'unconfirmed') return { outcome: 'failed' }
    if (policy.shows?.(held.payload)) {
      settle()
      return { outcome: 'saved' }
    }
    return run(held.payload, true)
  }

  return {
    phase: readonly(phase),
    busy: computed(() => phase.value === 'sending' || phase.value === 'retrying'),
    frozen: computed(() => phase.value === 'unconfirmed' || phase.value === 'retrying'),
    error: readonly(error),
    send(payload) {
      if (phase.value === 'unconfirmed') return retry()
      return phase.value === 'editing' ? run(payload, false) : Promise.resolve({ outcome: 'failed' })
    },
    retry,
    reset: settle,
  }
}

export interface UnconfirmedSender extends FreezeState {
  /** Sends a form's command. While unconfirmed it sends the unconfirmed command again instead (see retry). */
  send(command: Command): Promise<SendOutcome>
  /** Sends the unconfirmed command again with the same ids; 'saved' without a write when the shown copy already holds it
   *  (`shows`). Any failure but landedBefore keeps the form unconfirmed: the first attempt may still have landed. */
  retry(): Promise<SendOutcome>
}

/**
 * The write of a form that keeps its ids until it closes (useCommandIds), with the unknown outcome handled (spec 4.7):
 * after one, a relative or create command freezes the form until a retry or close; an absolute one (stock.set) does not.
 * `shows(command)`: the shown copy already holds what the command writes (it landed and the copy was loaded since).
 */
export function createUnconfirmedSender(
  apply: (command: Command) => Promise<void>,
  shows: (command: Command) => boolean = () => false,
): UnconfirmedSender {
  const core = createUnconfirmedCore<Command, unknown>(apply, {
    freezesOn: (command, e) => isUnknownOutcome(e) && !isAbsolute(command),
    landedBefore,
    shows,
  })
  return {
    ...core,
    send: async (command) => (await core.send(command)).outcome,
    retry: async () => (await core.retry()).outcome,
  }
}

/**
 * An id that follows a payload: the same payload keeps its id (a retry the source skips if it landed), a changed one
 * gets a new id (so it is not skipped). For an absolute command (stock.set): a count edited after an unknown outcome
 * is written, and one sent twice adds only a zero adjustment.
 */
export function payloadId(): (payload: string) => Id {
  let last: { payload: string; id: Id } | null = null
  return (payload) => {
    if (last?.payload !== payload) last = { payload, id: newId() }
    return last.id
  }
}
