import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { ToolContext } from './context'
import { jsonResult, secretsOf, toToolResult } from './errors'
import * as photos from './tools/photos'
import * as read from './tools/read'

export const ACTOR_FALLBACK = 'AI · MCP'
export const SERVER_NAME = 'antresol'
export const SERVER_INSTRUCTIONS =
  'Antresol is a home inventory. These tools only read it and prepare intake drafts (receipts of purchased items); nothing is added to the stock until the person reviews and commits the intake in the Antresol app. Start with get_overview to learn the inventories, folders, attributes and units. Search before proposing a new item.'

/** A tool's handler as the SDK calls it: the result as JSON text, an error as `isError` text without secrets. */
export function handler<A>(ctx: ToolContext, run: (ctx: ToolContext, args: A) => Promise<unknown>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return jsonResult(await run(ctx, args))
    } catch (e) {
      return toToolResult(e, secretsOf(ctx.config))
    }
  }
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const
const inventory = z.string().optional().describe('Inventory id or name; may be left out when there is only one inventory.')

export function registerReadTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'get_overview',
    {
      description:
        'Call first. Lists the inventories (with currency), folders with paths and item counts, attributes with units, tags, units, and where photos are looked for.',
      inputSchema: { inventory },
      annotations: READ_ONLY,
    },
    handler(ctx, read.getOverview),
  )
  server.registerTool(
    'search',
    {
      description:
        'Find items and variants by name, number or value ("4k7", "esp32"). Call before adding anything, to see what is already in stock.',
      inputSchema: {
        query: z.string().describe('Words, a part number or a value.'),
        inventory,
        limit: z.number().int().optional().describe('Results to return, 20 by default, at most 50.'),
      },
      annotations: READ_ONLY,
    },
    handler(ctx, read.search),
  )
  server.registerTool(
    'get_item',
    {
      description: 'One item by id: folder, tags, attributes, variants with stock, photos and its last 5 receipts (date, amount, price, link, intake).',
      inputSchema: { item: z.string().describe('Item id, from search or get_folder.') },
      annotations: READ_ONLY,
    },
    handler(ctx, read.getItem),
  )
  server.registerTool(
    'get_folder',
    {
      description: 'The sub-folders and items of one folder. Use to look around when you do not know the name of an item.',
      inputSchema: {
        folder: z.string().default('').describe('Folder id or a path like "Passives/Resistors"; empty for the root.'),
        inventory,
      },
      annotations: READ_ONLY,
    },
    handler(ctx, read.getFolder),
  )
  server.registerTool(
    'list_intakes',
    {
      description: 'Intakes (batches of receipts, drafts and committed), newest first. Call to find a draft to continue or an order already entered.',
      inputSchema: {
        inventory,
        query: z.string().optional().describe('Text to find in the shop, order number, note or date.'),
        status: z.enum(['draft', 'committed']).optional(),
      },
      annotations: READ_ONLY,
    },
    handler(ctx, read.listIntakes),
  )
  server.registerTool(
    'get_intake',
    {
      description: 'One intake in full: header, items it would create (with "looks like" warnings), and lines with their problems.',
      inputSchema: { intake: z.string().describe('Intake id, from list_intakes.') },
      annotations: READ_ONLY,
    },
    handler(ctx, read.getIntake),
  )
  server.registerTool(
    'refresh',
    {
      description: 'Forget what was read and read the database again. Call when the person says they changed something in the app.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handler(ctx, (c) => read.refresh(c)),
  )
}

export function registerPhotoTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'list_photos',
    {
      description:
        'Lists the pictures (jpg, png, webp, heic) in the photos folder, newest first, with the draft line each one is already attached to. Folder defaults to the photos folder from get_overview.',
      inputSchema: {
        folder: z.string().optional().describe('A sub-folder or absolute path; the photos folder when left out.'),
        onlyNew: z.boolean().optional().describe('Only pictures not yet attached to a draft line.'),
      },
      annotations: READ_ONLY,
    },
    handler(ctx, photos.listPhotos),
  )
  server.registerTool(
    'view_photos',
    {
      description: 'Shows 1 to 6 pictures (path from list_photos) so you can see what is on them. Each is preceded by its path.',
      inputSchema: { paths: z.array(z.string()).describe('Absolute paths, or paths relative to the photos folder.') },
      annotations: READ_ONLY,
    },
    (args) => photos.viewPhotos(ctx, args),
  )
}

/**
 * The server with its tools. Sets `ctx.actor`: the connected client's name after `initialize`, as "<name> · MCP"
 * ("AI · MCP" without a client name).
 */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS })
  ctx.actor = () => {
    const name = server.server.getClientVersion()?.name?.trim()
    return { device: name ? `${name} · MCP` : ACTOR_FALLBACK }
  }
  registerReadTools(server, ctx)
  registerPhotoTools(server, ctx)
  return server
}
