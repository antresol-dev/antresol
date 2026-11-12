import type { Actor, Command } from '@antresol/core'
import type { Statement } from '../sql'
import { archiveStatements } from './archive'
import { dictionaryStatements } from './dictionaries'
import { folderStatements } from './folders'
import { inventoryStatements } from './inventory'
import { itemStatements } from './items'
import { photoStatements } from './photos'
import { stockStatements } from './stock'
import { variantStatements } from './variants'

/**
 * Translate a command into SQL statements that run as one atomic batch.
 *
 * Every insert with a client-made id is `on conflict (id) do nothing`, so replaying a command (a retry after a timeout)
 * changes nothing. The flip side: a different command that reuses an existing id is silently ignored too. That is safe
 * only because ids are minted on the device as UUIDv7, so a collision between unrelated commands cannot happen.
 */
export function toStatements(c: Command, actor: Actor): Statement[] {
  switch (c.type) {
    case 'inventory.create':
    case 'inventory.update':
      return inventoryStatements(c, actor)
    case 'folder.create':
    case 'folder.update':
    case 'folder.move':
      return folderStatements(c, actor)
    case 'tag.create':
    case 'tag.rename':
    case 'tag.delete':
    case 'attribute.create':
    case 'attribute.update':
    case 'attribute.delete':
    case 'unit.create':
    case 'unit.update':
    case 'unit.delete':
      return dictionaryStatements(c, actor)
    case 'item.create':
    case 'item.update':
    case 'item.setAttribute':
    case 'item.removeAttribute':
    case 'item.addAxis':
    case 'item.removeAxis':
    case 'item.reorderAxes':
      return itemStatements(c, actor)
    case 'variant.createMany':
    case 'variant.update':
    case 'variant.setAttribute':
    case 'variant.setValues':
      return variantStatements(c, actor)
    case 'photo.add':
    case 'photo.replace':
    case 'photo.remove':
    case 'photo.reorder':
      return photoStatements(c, actor)
    case 'stock.receive':
    case 'stock.use':
    case 'stock.return':
    case 'stock.set':
    case 'stock.transfer':
      return stockStatements(c, actor)
    case 'archive':
    case 'restore':
    case 'deletePermanently':
      return archiveStatements(c, actor)
  }
}
