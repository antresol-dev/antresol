import type { Id } from './ids'
import type { AttributeKind } from './model'
import type { Quantity } from './quantity'

export type Command =
  | { type: 'inventory.create'; id: Id; name: string; description: string | null; currency: string }
  | { type: 'inventory.update'; id: Id; name?: string; description?: string | null }
  | { type: 'folder.create'; id: Id; inventoryId: Id; parentId: Id | null; name: string; description: string | null }
  | { type: 'folder.update'; id: Id; name?: string; description?: string | null }
  | { type: 'folder.move'; id: Id; parentId: Id | null }
  | {
      type: 'item.create'
      id: Id
      inventoryId: Id
      folderId: Id | null
      name: string
      description: string | null
      unitKey: string
      tagIds: Id[]
      initialReceipt: { movementId: Id; quantity: Quantity; totalPrice: number | null; sourceUrl: string | null } | null
    }
  | { type: 'item.update'; id: Id; name?: string; description?: string | null; folderId?: Id | null; unitKey?: string; tagIds?: Id[] }
  /** Shared attributes only: attaches the attribute as shared if it is not attached yet. */
  | { type: 'item.setAttribute'; itemId: Id; attributeId: Id; value: string | null }
  /** Shared attribute or axis; an axis goes as item.removeAxis does, then the link is removed. */
  | { type: 'item.removeAttribute'; itemId: Id; attributeId: Id }
  /** Attaches the attribute as the last axis, or turns a shared one into an axis. A shared value moves to every
   *  variant. With no variants it becomes the first variant, `firstVariantId`, only if the attribute was shared with a
   *  non-empty value AND the item has no other axis; if another axis exists, only the role changes and the shared
   *  value is dropped. Already an axis: nothing happens. */
  | { type: 'item.addAxis'; itemId: Id; attributeId: Id; firstVariantId: Id }
  /** Axis -> shared. A value every variant shares becomes the item's value; the variants' values go. */
  | { type: 'item.removeAxis'; itemId: Id; attributeId: Id }
  | { type: 'item.reorderAxes'; itemId: Id; attributeIds: Id[] }
  /** Each variant needs a value on every axis of the item. */
  | { type: 'variant.createMany'; itemId: Id; variants: { id: Id; values: { attributeId: Id; value: string }[] }[] }
  | { type: 'variant.update'; id: Id; description?: string | null }
  /** Axes only; null erases the value. */
  | { type: 'variant.setAttribute'; variantId: Id; attributeId: Id; value: string | null }
  | { type: 'tag.create'; id: Id; inventoryId: Id; name: string }
  | { type: 'tag.rename'; id: Id; name: string }
  | { type: 'tag.delete'; id: Id }
  | {
      type: 'attribute.create'
      id: Id
      inventoryId: Id
      name: string
      kind: AttributeKind
      options: string[]
      unit: string
      siPrefixes: boolean
    }
  /** The kind never changes. A new unit or prefix setting changes only how values are shown and parsed. `pinned`: at
   *  most MAX_PINNED_ATTRIBUTES per inventory; a pin over the limit is skipped (the other fields still apply). */
  | {
      type: 'attribute.update'
      id: Id
      name?: string
      options?: string[]
      unit?: string
      siPrefixes?: boolean
      pinned?: boolean
    }
  | { type: 'attribute.delete'; id: Id }
  | { type: 'unit.create'; id: Id; inventoryId: Id; name: string; symbol: string; prefixPowers: number[] }
  | { type: 'unit.update'; id: Id; name?: string; symbol?: string; prefixPowers?: number[] }
  | { type: 'unit.delete'; id: Id }
  | {
      type: 'stock.receive'
      movementId: Id
      itemId: Id
      variantId: Id | null
      quantity: Quantity
      totalPrice: number | null
      sourceUrl: string | null
      note: string | null
    }
  | { type: 'stock.use' | 'stock.return'; movementId: Id; itemId: Id; variantId: Id | null; quantity: Quantity; note: string | null }
  | { type: 'stock.set'; movementId: Id; itemId: Id; variantId: Id | null; target: Quantity; note: string | null }
  | {
      type: 'stock.transfer'
      transferId: Id
      outMovementId: Id
      inMovementId: Id
      itemId: Id
      fromVariantId: Id | null
      toVariantId: Id | null
      quantity: Quantity
    }
  | { type: 'photo.add'; id: Id; itemId: Id; variantId: Id | null; provider: string; fileId: string; url: string }
  | { type: 'photo.remove'; id: Id }
  | { type: 'photo.reorder'; itemId: Id; orderedIds: Id[] }
  | { type: 'archive'; target: 'inventory' | 'folder' | 'item' | 'variant'; id: Id; archiveId: Id }
  | { type: 'restore'; archiveId: Id }
  | { type: 'deletePermanently'; target: 'inventory' | 'folder' | 'item' | 'variant'; id: Id }
