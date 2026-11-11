import { addQ, cmpQ, negQ, newId, type Command, type Id, type Quantity } from '@graymatter/core'
import { computed, readonly, ref, shallowRef, type ComputedRef, type Ref } from 'vue'

/**
 * The deferred stepper of one stock bucket (spec 4.12): "+" and "−" presses add up into a pending delta, and one movement
 * of the sum goes out `delayMs` after the last press. The confirmed quantity is never changed here (no optimistic
 * updates): the pending delta is shown as pending until the source has taken it.
 *
 * - idle: nothing pending;
 * - waiting: a delta is pending and the timer runs; presses add to it, undo drops it, flush sends it now;
 * - sending: the delta is on its way; presses and undo are ignored (the bucket is locked);
 * - failed: the send failed; the delta stays until retry (same movementId, so a send that did land is not written
 *   twice) or discard. Presses are ignored: a changed delta under the same id would be dropped by the source. When a
 *   send's outcome was unknown, `unconfirmed` says it may have landed.
 */
export type StepperState = 'idle' | 'waiting' | 'sending' | 'failed'

export interface StepperOptions {
  delayMs: number
  /** Writes one movement of `delta` (never zero). A retry of the same send passes the same movementId. */
  send: (delta: Quantity, movementId: Id) => Promise<void>
  /** Clock for `due`, in ms; Date.now by default. */
  now?: () => number
  /** The bucket's confirmed quantity: "−" never takes it plus the pending delta below zero (insufficient stock is
   *  refused before it is sent). Without it "−" is not limited. */
  available?: () => Quantity
  /** The failure leaves it unknown whether the send landed (a timeout, a dropped connection). */
  unknownOutcome?: (error: unknown) => boolean
}

export interface Stepper {
  press(step: 1 | -1): void
  /** Drops a waiting delta; nothing is written. */
  undo(): void
  /** Sends a waiting delta now, retries a failed one; resolves when the send is over, never rejects (see `state`). */
  flush(): Promise<void>
  /** Sends a failed delta again with the same movementId. */
  retry(): Promise<void>
  /** Drops a failed delta. */
  discard(): void
  pending: Readonly<Ref<Quantity>>
  state: Readonly<Ref<StepperState>>
  /** The last failure while `failed`, else null. */
  error: Readonly<Ref<unknown>>
  /** A send of the pending delta had an unknown outcome (StepperOptions.unknownOutcome): it may have landed. Retry is
   *  safe (same movementId). Until the delta lands or is discarded. */
  unconfirmed: Readonly<Ref<boolean>>
  /** When the waiting delta goes out (ms by `now`); null unless waiting. */
  due: Readonly<Ref<number | null>>
  /** The quantity after the pending delta: from the live confirmed quantity while waiting, from the one the delta was
   *  sent against while sending or failed (the copy may already show it). Needs `available`. */
  projected: ComputedRef<Quantity>
  /** "−" would not take the projected quantity below zero. */
  canDecrease: ComputedRef<boolean>
}

const ZERO: Quantity = '0'

export function createStepper(opts: StepperOptions): Stepper {
  const now = opts.now ?? Date.now
  const pending = ref<Quantity>(ZERO)
  const state = ref<StepperState>('idle')
  const error = shallowRef<unknown>(null)
  const unconfirmed = ref(false)
  const due = ref<number | null>(null)
  /** The confirmed quantity the delta was sent against; null while waiting. */
  const sentFrom = ref<Quantity | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  /** One id per deferred send, kept across its retries until it lands or is dropped. */
  let movementId: Id | null = null
  let inflight: Promise<void> | null = null

  const available = (): Quantity => opts.available?.() ?? ZERO
  const projected = computed(() => addQ(sentFrom.value ?? available(), pending.value))
  const canDecrease = computed(() => !opts.available || cmpQ(addQ(available(), pending.value), '1') >= 0)

  function stopTimer(): void {
    clearTimeout(timer)
    timer = undefined
    due.value = null
  }

  function reset(): void {
    stopTimer()
    pending.value = ZERO
    movementId = null
    sentFrom.value = null
    error.value = null
    unconfirmed.value = false
    state.value = 'idle'
  }

  function send(): Promise<void> {
    if (inflight) return inflight
    stopTimer()
    movementId ??= newId()
    sentFrom.value ??= opts.available ? available() : null
    state.value = 'sending'
    error.value = null
    const run = opts.send(pending.value, movementId).then(
      () => reset(),
      (e: unknown) => {
        error.value = e
        if (opts.unknownOutcome?.(e)) unconfirmed.value = true
        state.value = 'failed'
      },
    )
    inflight = run.finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    press(step) {
      if (state.value === 'sending' || state.value === 'failed') return
      if (step < 0 && !canDecrease.value) return
      pending.value = addQ(pending.value, step > 0 ? '1' : negQ('1'))
      if (cmpQ(pending.value, ZERO) === 0) {
        reset()
        return
      }
      state.value = 'waiting'
      stopTimer()
      due.value = now() + opts.delayMs
      timer = setTimeout(() => void send(), opts.delayMs)
    },
    undo() {
      if (state.value === 'waiting') reset()
    },
    flush() {
      if (state.value === 'waiting' || state.value === 'failed' || state.value === 'sending') return send()
      return Promise.resolve()
    },
    retry() {
      return state.value === 'failed' ? send() : Promise.resolve()
    },
    discard() {
      if (state.value === 'failed') reset()
    },
    pending: readonly(pending),
    state: readonly(state),
    error: readonly(error),
    unconfirmed: readonly(unconfirmed),
    due: readonly(due),
    projected,
    canDecrease,
  }
}

/** The command for a pending delta: a receipt without a price for "+", a use for "−", nothing for zero. */
export function stepCommand(delta: Quantity, target: { itemId: Id; variantId: Id | null }, movementId: Id): Command | null {
  const sign = cmpQ(delta, ZERO)
  if (sign === 0) return null
  const { itemId, variantId } = target
  return sign > 0
    ? { type: 'stock.receive', movementId, itemId, variantId, quantity: delta, totalPrice: null, sourceUrl: null, note: null }
    : { type: 'stock.use', movementId, itemId, variantId, quantity: negQ(delta), note: null }
}

type PageEvents = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: DocumentVisibilityState }

/** Calls `flush` when the page is hidden (visibilitychange) or goes away (pagehide); returns the cleanup. */
export function flushWhenHidden(target: PageEvents, flush: () => void): () => void {
  const onVisibility = (): void => {
    if (target.visibilityState === 'hidden') flush()
  }
  const onPageHide = (): void => flush()
  target.addEventListener('visibilitychange', onVisibility)
  target.addEventListener('pagehide', onPageHide)
  return () => {
    target.removeEventListener('visibilitychange', onVisibility)
    target.removeEventListener('pagehide', onPageHide)
  }
}

/** 8 ms of vibration per stepper press where the device has it (Android Chrome); silent elsewhere. */
export function buzz(): void {
  try {
    navigator.vibrate?.(8)
  } catch {
    // Some browsers throw without a user gesture or under a permissions policy: haptics are optional.
  }
}
