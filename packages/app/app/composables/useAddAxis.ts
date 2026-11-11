import { newId, variantLabel, type Id } from '@graymatter/core'
import { looseTransferOffer } from '~/lib/item-view'

export interface AxisAdded {
  /** The stock kept without a variant, to offer moving into the first variant the axis just made. */
  offer: NonNullable<ReturnType<typeof looseTransferOffer>>
  variants: { id: Id; name: string }[]
}

/**
 * Makes an attribute a variant axis of an item. An item with no variants gets its first one from the shared value; when it
 * had stock without a variant, the result carries the offer to move that stock into the new variant (null otherwise).
 * Throws what the write throws.
 */
export function useAddAxis() {
  const workspace = useWorkspace()
  return async (itemId: Id, attributeId: Id): Promise<AxisAdded | null> => {
    const before = workspace.state.snapshot
    const offer = before ? looseTransferOffer(before, itemId) : null
    const firstVariantId = newId()
    await workspace.apply({ type: 'item.addAxis', itemId, attributeId, firstVariantId })
    const after = workspace.state.snapshot
    const created = after?.variants.find((v) => v.id === firstVariantId)
    if (!offer || !after || !created) return null
    return { offer, variants: [{ id: created.id, name: variantLabel(after, created) }] }
  }
}
