import type { Id } from './ids'
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
  | { type: 'item.setAttribute'; itemId: Id; attributeId: Id; value: string | null }
  | { type: 'item.removeAttribute'; itemId: Id; attributeId: Id }
  | { type: 'variant.createMany'; itemId: Id; variants: { id: Id; name: string }[] }
  | { type: 'variant.update'; id: Id; name?: string; description?: string | null }
  | { type: 'variant.setAttribute'; variantId: Id; attributeId: Id; value: string | null }
  | { type: 'tag.create'; id: Id; inventoryId: Id; name: string }
  | { type: 'tag.rename'; id: Id; name: string }
  | { type: 'tag.delete'; id: Id }
  | { type: 'attribute.create'; id: Id; inventoryId: Id; name: string; kind: 'text' | 'enum'; options: string[] }
  | { type: 'attribute.update'; id: Id; name?: string; options?: string[] }
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
