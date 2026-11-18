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
  'Antresol is a home inventory. These tools only read it and prepare intake drafts (receipts of purchased items, with the folders, items and everything the items need: attributes, tags, units, list values); nothing is added to the stock until the person reviews and commits the intake in the Antresol app. Start with get_overview to learn the inventories, folders, attributes (with their list values), tags and units. Search before proposing a new item, and prefer topping up an existing item or adding a value to it over a new item. Every write answers with `similar`: names that look like each new name; check it, and use the existing one when it is the same thing. An exact duplicate (same name after trimming, any case) is refused. Attributes, tags and units are declared only under the item that needs them. Do not guess: put doubts in the chat, not in the draft. The person commits the intake in the app.'

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
        'Call first. Lists the inventories (with currency), folders with paths and item counts, attributes with kind (number, list, text) and the values of list attributes, tags (with colours), units with the prefixes they take, and where photos are looked for.',
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
      description: 'One intake in full: header, and what it would create: folders (with icons), units, attributes (pinned or not), tags (with colours), values added to existing lists, and items (with icon and colour, "looks like" warnings and problems), and lines with their problems and variant descriptions. A committed intake also lists what it created.',
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

const attributeArg = z.object({
  attribute: z.string().describe('An existing attribute (id or name), or the name of a new one when kind is given.'),
  value: z.string().optional().describe('The item\'s own value, shared by all its variants.'),
  axis: z.boolean().optional().describe('true: variant attribute, each line gives its own value (so no value here).'),
  kind: z.enum(['number', 'list', 'text']).optional().describe('Only for a NEW attribute. A name that exists in stock is refused: use the existing attribute without kind. Declaring again an attribute this draft made (same name) changes it.'),
  unit: z.string().optional().describe('new number: the unit symbol, like "Ω" or "V".'),
  siPrefixes: z.boolean().optional().describe('new number: values may take k, M, µ, ... prefixes.'),
  options: z.array(z.string()).optional().describe('new list: the choices, in order.'),
  pinned: z.boolean().optional().describe('new: show in lists (at most two attributes of an inventory).'),
})
const tagArg = z.union([z.string(), z.object({ name: z.string(), color: z.string().optional().describe('#RRGGBB, for a NEW tag only: a tag that already exists (in stock or in this draft) keeps its colour and this one is ignored.') })])
const unitArg = z.union([
  z.string(),
  z.object({
    name: z.string(),
    symbol: z.string(),
    prefixes: z.array(z.union([z.string(), z.number()])).optional().describe('Prefixes amounts may take: symbols like "k", "M", "m", "µ" or powers of ten like 3, -3.'),
  }),
])
const valueArg = z.object({ attribute: z.string().describe('An existing list attribute (id or name).'), value: z.string() })
const addValues = z.array(valueArg).optional().describe('Values to add to list attributes (existing, or one this draft declares); a line or item must use them. The list may not have them already (any case).')
const declarations = {
  unit: unitArg.optional().describe('An existing unit (key, symbol or name) or a new one {name, symbol, prefixes}; "pcs" by default.'),
  attributes: z.array(attributeArg).optional().describe('Attributes of the item: existing by id or name, or new with kind.'),
  tags: z.array(tagArg).optional().describe('Tag ids or names; an unknown name is a new tag, {name, color} gives it a colour.'),
  icon: z.string().optional().describe('A Lucide icon name in kebab-case, like "package" or "cable".'),
  color: z.string().optional().describe('#RRGGBB.'),
  addValues,
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
        'Add receipt lines to an intake draft, all or none: if any line is wrong nothing is saved and every problem is listed. Search first (search) and top up what already exists: add a value ("4k7") to an existing item before creating a new item. A line is an item (id from search, or the id or ref of a new item), its values for the item\'s variant attributes (by attribute name or id), an amount and optionally the price paid for the whole line and a link. Write amounts, values and prices as a person would: "10", "4k7", "2.5 m", "35.50". To bring something that is not in the inventory, describe it in newItems (ref, name, folder, icon, color, unit, attributes, tags) and point lines at its ref; an attribute with axis: true makes each line give its own value. Everything a new item needs is declared under it: an existing attribute by name or id, or a new one with kind (list: options; number: unit, siPrefixes; pinned shows it in lists); tags by name (a new one may have a color); a unit by symbol, or a new unit {name, symbol, prefixes}. A line (of an existing item too) may add values to an existing list attribute with addValues [{attribute, value}] and use them at once, and may carry a description of the new variant it creates. Folders are made first with create_folder (then named by path). Check the answer\'s `similar` for each new name and the overview before creating: prefer what exists, never rely on case, spaces or plurals. A name an item of the same folder already has (even an archived one) is refused and the existing one is named. A new item may carry a description and its own photos (paths from list_photos, in `photos`: several photos of one item go there, the first is the cover; at most 20). A line may carry a photo only when it makes a new item or a new variant, not when it tops up stock that exists; the photo of a line of a new item without variant attributes is added to the item\'s photos. A second line that makes the same new variant is refused (edit the first line). Every file is checked before any is uploaded, and pictures are uploaded before anything is saved.',
      inputSchema: {
        intake: intakeId,
        newItems: z
          .array(
            z.object({
              ref: z.string().describe('A short name for this call; lines use it as "item".'),
              name: z.string(),
              folder: z.string().optional().describe('Folder id or path like "Passives/Resistors"; root when left out.'),
              ...declarations,
              description: z.string().optional().describe('A line or two about the item.'),
              photos: z.array(z.string()).optional().describe('The item\'s own pictures: paths from list_photos, in order; the first is the cover. Several photos of one item go here. At most 20; each file is uploaded once.'),
              photo: z.string().optional().describe('Not used: refused. Give the item\'s pictures in `photos`.'),
              withoutLines: z.boolean().optional().describe('true: make the item with no line, so with no stock yet.'),
            }),
          )
          .optional(),
        lines: z
          .array(
          z.object({
            item: z.string().describe('Item id, id of a new item of the intake, or a ref from newItems.'),
            values: z.record(z.string(), z.string()).optional().describe('Variant attribute (name or id) -> value text, like {"Resistance": "4k7"}.'),
            amount: z.string().describe('How much is received, like "10" or "2.5 m".'),
            price: z.string().optional().describe('Total price of the line, like "35.50".'),
            url: z.string().optional().describe('Link to the product, https://...'),
            photo: z.string().optional().describe('A picture to attach to the line: a path from list_photos (absolute or relative to the photos folder). It is uploaded once to the photo store, whatever line it is used on.'),
            addValues,
            description: z.string().optional().describe('A description of the variant this line creates (not for a line that tops up stock).'),
          }),
          )
          .optional()
          .describe('May be left out when every new item has withoutLines: true.'),
      },
      annotations: WRITE,
    },
    writer(ctx, drafts.addIntakeLines),
  )
  server.registerTool(
    'update_intake_line',
    {
      description: 'Change one line of an intake draft: only what is passed changes. An empty price or url clears it; photo sets or (empty) removes the line\'s picture (for a line of a new item without variant attributes the photo is added to the item\'s photos instead, and an empty value removes nothing); addValues adds values to existing list attributes; description sets the description of the variant the line creates.',
      inputSchema: {
        intake: intakeId,
        line: z.string().describe('Line id, from get_intake.'),
        values: z.record(z.string(), z.string()).optional(),
        amount: z.string().optional(),
        price: z.string().optional(),
        url: z.string().optional(),
        photo: z.string().optional().describe('A picture path from list_photos to attach to the line (uploaded once); an empty text removes the line\'s photo (not for a line of a new item without variant attributes: its photo joins the item\'s photos).'),
        addValues,
        description: z.string().optional().describe('The description of the variant this line creates; an empty text clears it.'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateIntakeLine),
  )
  server.registerTool(
    'remove_intake_line',
    {
      description: 'Remove a line from an intake draft. A new item the line belonged to stays (use remove_new_item to drop it).',
      inputSchema: { intake: intakeId, line: z.string().describe('Line id, from get_intake.') },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    writer(ctx, drafts.removeIntakeLine),
  )
  server.registerTool(
    'update_new_item',
    {
      description:
        'Change an item the draft will create (its name, description, photos, folder, icon, color, unit, attributes or tags). Only what is passed changes; attributes and tags replace the lists and may declare new ones as in add_intake_lines; photos is a list of paths that replaces the item\'s photos ([] removes them all); an empty icon or color removes it. Refused when the name is taken in the folder. Not for items already in stock.',
      inputSchema: {
        intake: intakeId,
        item: z.string().describe('Id of the new item, from get_intake.'),
        name: z.string().optional(),
        description: z.string().optional().describe('An empty text clears it.'),
        folder: z.string().optional().describe('Folder id or path, also a new folder of the draft.'),
        ...declarations,
        photo: z.string().optional().describe('Not used: refused. Give the item\'s pictures in `photos`.'),
        photos: z.array(z.string()).optional().describe('Picture paths from list_photos, in order (the first is the cover; at most 20; each file is uploaded once). The list replaces all of the item\'s photos; an empty list removes them all; leave it out to keep them as they are.'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateNewItem),
  )
  server.registerTool(
    'remove_new_item',
    {
      description: 'Remove an item the draft would create, together with its lines. Not for items already in stock.',
      inputSchema: { intake: intakeId, item: z.string().describe('Id of the new item, from get_intake.') },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    writer(ctx, drafts.removeNewItem),
  )
  server.registerTool(
    'create_folder',
    {
      description:
        'Add a folder to an intake draft; it is made when the person commits. Check get_overview and search first: use a folder that already fits. A name the parent already has (an archived folder too) is refused and the existing folder is named; the answer lists `similar` folder names. Items then use it by path in "folder".',
      inputSchema: {
        intake: intakeId,
        name: z.string(),
        parent: z.string().optional().describe('Parent folder: id or path, in stock or a new folder of this draft; the root when left out.'),
        icon: z.string().optional().describe('A Lucide icon name in kebab-case, like "wrench".'),
      },
      annotations: WRITE,
    },
    writer(ctx, drafts.createFolder),
  )
  server.registerTool(
    'update_folder',
    {
      description: 'Rename or move a folder the draft will create (not a folder already in stock). Only what is passed changes; an empty parent moves it to the root.',
      inputSchema: {
        intake: intakeId,
        folder: z.string().describe('The new folder: id or path, from get_intake.'),
        name: z.string().optional(),
        parent: z.string().optional().describe('Id or path of the new parent; empty for the root.'),
        icon: z.string().optional().describe('A Lucide icon name; an empty text removes it.'),
      },
      annotations: { ...WRITE, idempotentHint: true },
    },
    writer(ctx, drafts.updateFolder),
  )
  server.registerTool(
    'remove_folder',
    {
      description: 'Remove a folder the draft will create. Refused while a new folder or new item is in it.',
      inputSchema: { intake: intakeId, folder: z.string().describe('The new folder: id or path, from get_intake.') },
      annotations: { ...WRITE, destructiveHint: true, idempotentHint: true },
    },
    writer(ctx, drafts.removeFolder),
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
