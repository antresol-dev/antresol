import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { ensureOpen, type ToolContext } from './context'
import { jsonResult, secretsOf, toToolResult } from './errors'
import pkg from '../package.json'
import { intakeFromPhotosPrompt } from './prompts'
import * as drafts from './tools/drafts'
import * as photos from './tools/photos'
import * as read from './tools/read'

export const ACTOR_FALLBACK = 'AI · MCP'
export const SERVER_NAME = 'antresol'
export const SERVER_INSTRUCTIONS =
  'Antresol is a home inventory. These tools only read it and prepare intake drafts (receipts of purchased items); nothing is added to the stock until the person reviews and commits the intake in the Antresol app. Start with get_overview to learn the inventories, folders, attributes and units. Search before proposing a new item, and prefer topping up an existing item or adding a value to it over a new item. Do not guess: put doubts in the chat, not in the draft. The person commits the intake in the app.'

/** A tool's handler as the SDK calls it: the result as JSON text, an error as `isError` text without secrets. */
export function handler<A>(
  ctx: ToolContext,
  run: (ctx: ToolContext, args: A) => Promise<unknown>,
  options: { write?: boolean } = {},
): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      await ensureOpen(ctx)
      return jsonResult(await run(ctx, args))
    } catch (e) {
      return toToolResult(e, secretsOf(ctx.config), options)
    }
  }
}

const writer = <A>(ctx: ToolContext, run: (ctx: ToolContext, args: A) => Promise<unknown>) => handler(ctx, run, { write: true })

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

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
const intakeId = z.string().describe('Intake id, from list_intakes or create_intake.')

export function registerDraftTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'create_intake',
    {
      description:
        'Start an intake draft: one purchase or batch of receipts. Nothing reaches the stock until the person commits it in the app. Look through list_intakes first: continue an existing draft of the same order instead of making a second.',
      inputSchema: {
        inventory,
        shop: z.string().optional(),
        orderNumber: z.string().optional(),
        purchasedOn: z.string().optional().describe('YYYY-MM-DD; today by default.'),
        note: z.string().optional(),
      },
      annotations: WRITE,
    },
    writer(ctx, drafts.createIntake),
  )
  server.registerTool(
    'update_intake_header',
    {
      description: 'Change the shop, order number, date or note of an intake (drafts and committed ones). Only what is passed changes; an empty text clears a field.',
      inputSchema: {
        intake: intakeId,
        shop: z.string().optional(),
        orderNumber: z.string().optional(),
        purchasedOn: z.string().optional().describe('YYYY-MM-DD.'),
        note: z.string().optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateIntakeHeader),
  )
  server.registerTool(
    'add_intake_lines',
    {
      description:
        'Add receipt lines to an intake draft, all or none: if any line is wrong nothing is saved and every problem is listed. Search first (search) and top up what already exists: add a value ("4k7") to an existing item before creating a new item. A line is an item (id from search, or the id or ref of a new item), its values for the item\'s variant attributes (by attribute name or id), an amount and optionally the price paid for the whole line and a link. Write amounts, values and prices as a person would: "10", "4k7", "2.5 m", "35.50". To bring something that is not in the inventory, describe it in newItems (ref, name, folder, unit, attributes, tags) and point lines at its ref; an attribute with axis: true makes each line give its own value. Unknown tag names become new tags. A line may carry a photo (path from list_photos); pictures are uploaded before anything is saved.',
      inputSchema: {
        intake: intakeId,
        newItems: z
          .array(
            z.object({
              ref: z.string().describe('A short name for this call; lines use it as "item".'),
              name: z.string(),
              folder: z.string().optional().describe('Folder id or path like "Passives/Resistors"; root when left out.'),
              unit: z.string().optional().describe('Unit key or symbol, "pcs" by default.'),
              attributes: z
                .array(z.object({ attribute: z.string().describe('Attribute id or name.'), value: z.string().optional(), axis: z.boolean().optional() }))
                .optional(),
              tags: z.array(z.string()).optional().describe('Tag ids or names.'),
            }),
          )
          .optional(),
        lines: z.array(
          z.object({
            item: z.string().describe('Item id, id of a new item of the intake, or a ref from newItems.'),
            values: z.record(z.string(), z.string()).optional().describe('Variant attribute (name or id) -> value text, like {"Resistance": "4k7"}.'),
            amount: z.string().describe('How much is received, like "10" or "2.5 m".'),
            price: z.string().optional().describe('Total price of the line, like "35.50".'),
            url: z.string().optional().describe('Link to the product, https://...'),
            photo: z.string().optional().describe('A picture to attach to the line: a path from list_photos (absolute or relative to the photos folder). It is uploaded once to the photo store, whatever line it is used on.'),
            replacePhoto: z.boolean().optional().describe('Replace the photo the variant already has in stock with this one; otherwise the variant keeps its photo.'),
          }),
        ),
      },
      annotations: WRITE,
    },
    writer(ctx, drafts.addIntakeLines),
  )
  server.registerTool(
    'update_intake_line',
    {
      description: 'Change one line of an intake draft: only what is passed changes. An empty price or url clears it; photo sets or (empty) removes the line\'s picture.',
      inputSchema: {
        intake: intakeId,
        line: z.string().describe('Line id, from get_intake.'),
        values: z.record(z.string(), z.string()).optional(),
        amount: z.string().optional(),
        price: z.string().optional(),
        url: z.string().optional(),
        photo: z.string().optional().describe('A picture path from list_photos to attach to the line (uploaded once); an empty text removes the line\'s photo.'),
        replacePhoto: z.boolean().optional().describe('With a photo: replace the photo the variant already has in stock; otherwise it keeps its photo.'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateIntakeLine),
  )
  server.registerTool(
    'remove_intake_line',
    {
      description: 'Remove a line from an intake draft; a new item that no line uses any more goes with it.',
      inputSchema: { intake: intakeId, line: z.string().describe('Line id, from get_intake.') },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    writer(ctx, drafts.removeIntakeLine),
  )
  server.registerTool(
    'update_new_item',
    {
      description:
        'Change an item the draft will create (its name, folder, unit, attributes or tags). Only what is passed changes; attributes and tags replace the lists. Not for items already in stock.',
      inputSchema: {
        intake: intakeId,
        item: z.string().describe('Id of the new item, from get_intake.'),
        name: z.string().optional(),
        folder: z.string().optional(),
        unit: z.string().optional(),
        attributes: z.array(z.object({ attribute: z.string(), value: z.string().optional(), axis: z.boolean().optional() })).optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateNewItem),
  )
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'intake_from_photos',
    {
      title: 'Intake from photos',
      description: 'Turn photos of purchased items into one intake draft, to be reviewed and committed in the Antresol app.',
      argsSchema: {
        folder: z.string().optional().describe('Folder with the photos; the one from get_overview by default.'),
        intake: z.string().optional().describe('Id of an existing intake draft to add the lines to instead of creating a new one.'),
      },
    },
    (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: intakeFromPhotosPrompt(args) } }] }),
  )
}

/**
 * The server with its tools. Sets `ctx.actor`: the connected client's name after `initialize`, as "<name> · MCP"
 * ("AI · MCP" without a client name).
 */
export function createServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: pkg.version }, { instructions: SERVER_INSTRUCTIONS })
  ctx.actor = () => {
    const name = server.server.getClientVersion()?.name?.trim()
    return { device: name ? `${name} · MCP` : ACTOR_FALLBACK }
  }
  registerReadTools(server, ctx)
  registerPhotoTools(server, ctx)
  registerDraftTools(server, ctx)
  registerPrompts(server)
  return server
}
