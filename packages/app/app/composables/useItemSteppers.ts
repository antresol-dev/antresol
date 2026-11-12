import { BUILTIN_UNITS, cmpQ, formatAmountParts, negQ, resolveUnit, StorageError, variantLabel, type Id, type Quantity, type UnitDef } from '@antresol/core'
import { toast } from 'vue-sonner'
import { errorMessageKey } from '~/lib/errors'
import { createStepper, flushWhenHidden, stepCommand, type Stepper } from '~/lib/stepper'
import { isUnknownOutcome, landedBefore } from '~/lib/unconfirmed'
import { bucketKey } from '~/lib/workspace'

/** Spec 4.12: one movement goes out 2 s after the last press. */
export const STEP_DELAY_MS = 2000

export interface BucketStepper extends Stepper {
  itemId: Id
  variantId: Id | null
  /** "Item · variant" when it was created: what a toast names after the screen is gone. */
  label: string
}

/** "+3" or "−2" (U+2212) with the unit's prefix. */
export function signedAmount(delta: Quantity, unit: UnitDef): { number: string; unit: string } {
  const negative = cmpQ(delta, '0') < 0
  const parts = formatAmountParts(negative ? negQ(delta) : delta, unit)
  return { number: `${negative ? '−' : '+'}${parts.number}`, unit: parts.unit }
}

/**
 * The deferred steppers of one item's stock buckets, created on first use. Each writes to the inventory that was current
 * when it was created. A pending delta goes out early (spec 4.12):
 * - before any other write (a form, a sheet, an action), so that write sees it; another stepper's write does not flush
 *   it, so a bucket being tapped is not cut short by a neighbour's send;
 * - when the page is hidden or goes away;
 * - when the screen lets go of the item (another item, unmount). A send that fails after that cannot show its chip any
 *   more: a toast says what was not saved and offers a retry (with the same movementId).
 * After an unknown outcome the delta is unconfirmed (it may have landed): a retry tries the source again first, and a
 * retried "−" refused for missing stock is taken as landed ("probably saved") instead of failing (spec 4.7).
 */
export function useItemSteppers(itemId: () => Id): { of(variantId: Id | null): BucketStepper } {
  const workspace = useWorkspace()
  const { state } = workspace
  const { t } = useI18n()

  let steppers = new Map<string, BucketStepper>()
  /** True while a stepper's own write is being queued: the before-write hook leaves the others alone then. */
  let ownWrite = false

  const confirmed = (id: Id, variantId: Id | null): Quantity =>
    state.snapshot?.stock.find((l) => l.itemId === id && l.variantId === variantId)?.quantity ?? '0'

  const unitOf = (id: Id): UnitDef => {
    const s = state.snapshot
    const item = s?.items.find((i) => i.id === id)
    return (item && s && resolveUnit(item.unitKey, s.units)) || BUILTIN_UNITS.pcs
  }

  function create(id: Id, variantId: Id | null): BucketStepper {
    const target = state.current ? { ...state.current } : null
    const label = nameOf(id, variantId)
    const stepper: Stepper = createStepper({
      delayMs: STEP_DELAY_MS,
      available: () => confirmed(id, variantId),
      unknownOutcome: isUnknownOutcome,
      send: async (delta, movementId) => {
        const command = stepCommand(delta, { itemId: id, variantId }, movementId)
        if (!command) return
        if (!target) throw new StorageError('not_found')
        // A retry after an unknown outcome: the first send may have landed.
        const retrying = stepper.unconfirmed.value
        let write: Promise<void>
        ownWrite = true
        try {
          // The before-write hooks run synchronously inside this call.
          write = workspace.applyTo(target, command)
        } finally {
          ownWrite = false
        }
        try {
          await write
        } catch (e) {
          if (!retrying || !landedBefore(command, e)) throw e
          toast(t('unconfirmed.probablySaved'))
        }
      },
    })
    const retry = stepper.retry
    return Object.assign(stepper, {
      itemId: id,
      variantId,
      label,
      // An unknown outcome left the source marked unreachable: a retry tries it again first (as the return to the app does).
      async retry() {
        if (stepper.state.value === 'failed' && state.readOnly === 'offline') await workspace.syncIfDue().catch(() => {})
        return retry()
      },
    })
  }

  function nameOf(id: Id, variantId: Id | null): string {
    const s = state.snapshot
    const item = s?.items.find((i) => i.id === id)?.name ?? ''
    const variant = variantId === null ? undefined : s?.variants.find((v) => v.id === variantId)
    return s && variant ? `${item} · ${variantLabel(s, variant)}` : item
  }

  function reportFailed(s: BucketStepper): void {
    if (s.state.value !== 'failed') return
    const delta = signedAmount(s.pending.value, unitOf(s.itemId))
    const unconfirmed = s.unconfirmed.value
    toast.error(t(unconfirmed ? 'stock.notConfirmedFor' : 'stock.notSavedFor', { delta: `${delta.number} ${delta.unit}`, name: s.label }), {
      description: unconfirmed ? t('stock.retrySafe') : t(errorMessageKey(s.error.value)),
      duration: 20_000,
      action: { label: t('stock.retry'), onClick: () => void s.retry().then(() => reportFailed(s)) },
    })
  }

  const flushAll = (): void => {
    for (const s of steppers.values()) void s.flush()
  }

  /** The screen is done with these steppers: what is pending goes out now; a failure is reported by toast. */
  function release(): void {
    const list = [...steppers.values()]
    steppers = new Map()
    for (const s of list) void s.flush().then(() => reportFailed(s))
  }

  const stopHook = workspace.onBeforeWrite(() => {
    if (!ownWrite) flushAll()
  })
  const stopHidden = import.meta.client ? flushWhenHidden(document, flushAll) : () => {}
  watch(itemId, release)
  onBeforeUnmount(() => {
    stopHook()
    stopHidden()
    release()
  })

  return {
    of(variantId) {
      const id = itemId()
      const key = bucketKey(id, variantId)
      let s = steppers.get(key)
      if (!s) {
        s = create(id, variantId)
        steppers.set(key, s)
      }
      return s
    },
  }
}
