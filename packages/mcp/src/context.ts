import type { Actor, FileStore, Inventory, InventorySnapshot, InventoryStorage } from '@antresol/core'
import type { ServerConfig } from './config'
import { ToolError } from './errors'
import type { Source } from './source'

export interface ToolContext {
  /** Null while there is no database: no key, a bad key, or `openError`. */
  source: Source | null
  storage: InventoryStorage | null
  config: ServerConfig
  /** Who writes: the connected client's name; createServer sets it once the client has introduced itself. */
  actor: () => Actor
  files: FileStore | null
  now: () => Date
  /** Why the database could not be opened (key present, open failed): every tool answers with it. */
  openError?: unknown
}

const NO_KEY =
  'Antresol is not connected: ANTRESOL_CONNECTION is not set. In the Antresol app open Settings → Connect AI, copy the connection key and set it as ANTRESOL_CONNECTION in this MCP server\'s environment.'
const BAD_KEY =
  'ANTRESOL_CONNECTION is not a valid connection key. In the Antresol app open Settings → Connect AI and copy the key again.'

function notConnected(ctx: ToolContext): unknown {
  if (ctx.openError !== undefined && ctx.openError !== null) return ctx.openError
  return new ToolError(ctx.config.connectionProblem === 'invalid' ? BAD_KEY : NO_KEY)
}

/** The source, or the reason there is none, thrown. */
export function requireSource(ctx: ToolContext): Source {
  if (!ctx.source) throw notConnected(ctx)
  return ctx.source
}

export function requireStorage(ctx: ToolContext): InventoryStorage {
  if (!ctx.storage) throw notConnected(ctx)
  return ctx.storage
}

const active = (list: Inventory[]): Inventory[] => list.filter((i) => i.archivedAt === null)
const listOf = (list: Inventory[]): string => list.map((i) => `${i.id} — ${i.name}`).join('\n')

/** The active inventories, for tools that look across all of them. */
export async function activeInventories(ctx: ToolContext): Promise<Inventory[]> {
  return active(await requireSource(ctx).inventories())
}

/** By id or by name (no case); the only inventory when there is one; several and no argument is an error that lists them. */
export async function resolveInventory(ctx: ToolContext, arg?: string): Promise<{ inventory: Inventory; snapshot: InventorySnapshot }> {
  const source = requireSource(ctx)
  const inventories = active(await source.inventories())
  const wanted = arg?.trim()
  let inventory: Inventory | undefined
  if (wanted) {
    const key = wanted.toLowerCase()
    const byId = inventories.find((i) => i.id === wanted)
    const byName = inventories.filter((i) => i.name.trim().toLowerCase() === key)
    if (byId) inventory = byId
    else if (byName.length === 1) inventory = byName[0]
    else if (byName.length > 1) throw new ToolError(`Several inventories are named "${wanted}"; pass the id:\n${listOf(byName)}`)
    else throw new ToolError(`No inventory "${wanted}". Inventories:\n${listOf(inventories)}`)
  } else if (inventories.length === 1) inventory = inventories[0]
  else if (inventories.length === 0) throw new ToolError('There are no inventories in this database yet. Create one in the app.')
  else throw new ToolError(`There are several inventories; pass "inventory" (id or name):\n${listOf(inventories)}`)
  return { inventory: inventory!, snapshot: await source.snapshot(inventory!.id) }
}
