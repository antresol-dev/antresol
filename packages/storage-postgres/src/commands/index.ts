import type { Actor, Command } from '@graymatter/core'
import type { Statement } from '../sql'
import { dictionaryStatements } from './dictionaries'
import { folderStatements } from './folders'
import { inventoryStatements } from './inventory'
import { itemStatements } from './items'
import { photoStatements } from './photos'
import { variantStatements } from './variants'

/** Translate a command into SQL statements that run as one atomic batch. Later tasks add their cases. */
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
      return itemStatements(c, actor)
    case 'variant.createMany':
    case 'variant.update':
    case 'variant.setAttribute':
      return variantStatements(c, actor)
    case 'photo.add':
    case 'photo.remove':
    case 'photo.reorder':
      return photoStatements(c, actor)
    default:
      throw new Error(`not implemented: ${c.type}`)
  }
}
