import { negQ, type Actor, type Command } from '@graymatter/core'
import { sql, type Statement } from '../sql'

type StockCommand = Extract<Command, { type: 'stock.receive' | 'stock.use' | 'stock.return' | 'stock.set' | 'stock.transfer' }>

/** One journal row; `inventory_id` is derived from the item inside the statement. */
function movement(
  id: string,
  itemId: string,
  variantId: string | null,
  kind: 'receipt' | 'usage' | 'return' | 'transfer',
  quantity: string,
  extra: { totalPrice?: number | null; sourceUrl?: string | null; note?: string | null; transferId?: string | null },
  by: string,
): Statement {
  return sql`insert into movements (id, inventory_id, item_id, variant_id, kind, quantity, total_price, source_url, note, transfer_id, created_by)
      select ${id}::uuid, i.inventory_id, i.id, ${variantId}::uuid, ${kind}, ${quantity}::numeric,
             ${extra.totalPrice ?? null}::bigint, ${extra.sourceUrl ?? null}, ${extra.note ?? null}, ${extra.transferId ?? null}::uuid, ${by}
      from items i where i.id = ${itemId}::uuid
      on conflict (id) do nothing`
}

export function stockStatements(c: StockCommand, actor: Actor): Statement[] {
  const by = actor.device
  switch (c.type) {
    case 'stock.receive':
      return [movement(c.movementId, c.itemId, c.variantId, 'receipt', c.quantity, c, by)]
    case 'stock.return':
      return [movement(c.movementId, c.itemId, c.variantId, 'return', c.quantity, c, by)]
    case 'stock.use':
      return [movement(c.movementId, c.itemId, c.variantId, 'usage', negQ(c.quantity), c, by)]
    case 'stock.set':
      return [
        sql`insert into movements (id, inventory_id, item_id, variant_id, kind, quantity, note, created_by)
            select ${c.movementId}::uuid, i.inventory_id, i.id, ${c.variantId}::uuid, 'adjustment',
                   ${c.target}::numeric - COALESCE(SUM(m.quantity), 0), ${c.note}, ${by}
            from items i
            left join movements m on m.item_id = i.id and m.variant_id is not distinct from ${c.variantId}::uuid
            where i.id = ${c.itemId}::uuid
            group by i.id, i.inventory_id
            on conflict (id) do nothing`,
      ]
    case 'stock.transfer': {
      const link = { transferId: c.transferId }
      return [
        movement(c.outMovementId, c.itemId, c.fromVariantId, 'transfer', negQ(c.quantity), link, by),
        movement(c.inMovementId, c.itemId, c.toVariantId, 'transfer', c.quantity, link, by),
      ]
    }
  }
}
