import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { encodeConnectionKey } from '@antresol/kit'
import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config'
import { secretsOf } from '../src/errors'
import { createServer } from '../src/server'
import { disconnectedContext, makeContext } from './fixture'

async function connect(ctx: Parameters<typeof createServer>[0], name = 'Test Client') {
  const server = createServer(ctx)
  const client = new Client({ name, version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return client
}

describe('protocol', () => {
  it('lists the read tools', async () => {
    const f = await makeContext()
    const client = await connect(f.ctx)
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_overview', 'search', 'get_item', 'get_folder', 'list_intakes', 'get_intake', 'refresh']))
    const overview = (await client.listTools()).tools.find((t) => t.name === 'get_overview')
    expect(overview?.description).toMatch(/Call first/)
    expect(client.getInstructions()).toMatch(/get_overview/)
  })

  it('lists the draft entity tools', async () => {
    const f = await makeContext()
    const client = await connect(f.ctx)
    const tools = (await client.listTools()).tools
    const names = tools.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining(['create_folder', 'update_folder', 'remove_folder', 'create_attribute', 'update_attribute', 'remove_attribute', 'remove_new_item', 'update_new_item', 'add_intake_lines']),
    )
    const add = tools.find((t) => t.name === 'add_intake_lines')!
    const item = (add.inputSchema.properties as any).newItems.items.properties
    expect(Object.keys(item)).toEqual(expect.arrayContaining(['description', 'photo', 'withoutLines']))
    expect((add.inputSchema as any).required).not.toContain('lines')
    const attr = tools.find((t) => t.name === 'create_attribute')!
    expect((attr.inputSchema.properties as any).kind.enum).toEqual(['number', 'list', 'text'])
    const result = (await client.callTool({ name: 'create_folder', arguments: { intake: 'nope', name: 'x' } })) as any
    expect(result.isError).toBe(true)
  })

  it('answers get_overview with JSON text', async () => {
    const f = await makeContext()
    const client = await connect(f.ctx)
    const result = (await client.callTool({ name: 'get_overview', arguments: {} })) as { content: { type: string; text: string }[]; isError?: boolean }
    expect(result.isError).toBeFalsy()
    const body = JSON.parse(result.content[0]!.text)
    expect(body.inventory.name).toBe('Electronics')
    expect(result.content[0]!.text).not.toContain('\n')
  })

  it('answers a search and a folder through the protocol', async () => {
    const f = await makeContext()
    const client = await connect(f.ctx)
    const found = (await client.callTool({ name: 'search', arguments: { query: 'esp32' } })) as any
    expect(JSON.parse(found.content[0].text).results[0].name).toBe('ESP32 DevKit')
    const root = (await client.callTool({ name: 'get_folder', arguments: {} })) as any
    expect(JSON.parse(root.content[0].text).folder.path).toBe('')
  })

  it('takes the actor from the client name', async () => {
    const f = await makeContext()
    expect(f.ctx.actor()).toEqual({ device: 'Test · Vitest' })
    const client = await connect(f.ctx, 'Test Client')
    expect(client.getServerVersion()?.name).toBe('antresol')
    expect(f.ctx.actor()).toEqual({ device: 'Test Client · MCP' })
  })

  it('falls back to "AI · MCP" when the client has no name', async () => {
    const f = await makeContext()
    expect(f.ctx.actor()).toEqual({ device: 'Test · Vitest' })
    await connect(f.ctx, '  ')
    expect(f.ctx.actor()).toEqual({ device: 'AI · MCP' })
  })

  it('answers a tool error as isError without secrets', async () => {
    const conn = 'postgresql://user:hunter2@ep-1.neon.tech/db'
    const key = encodeConnectionKey({ name: 'Home', connectionString: conn })
    const ctx = disconnectedContext()
    ctx.config = readConfig({ ANTRESOL_CONNECTION: key }, 'linux', '/home/a')
    ctx.openError = new Error(`connect failed: ${conn}`)
    expect(secretsOf(ctx.config)).toContain('hunter2')
    const client = await connect(ctx)
    const result = (await client.callTool({ name: 'get_overview', arguments: {} })) as any
    expect(result.isError).toBe(true)
    expect(result.content[0].text).not.toContain('hunter2')
    expect(result.content[0].text).toContain('[hidden]')
  })

  it('answers every tool with the connection problem when there is no key', async () => {
    const client = await connect(disconnectedContext())
    const calls: [string, Record<string, unknown>][] = [
      ['get_overview', {}],
      ['search', { query: 'x' }],
      ['get_item', { item: 'x' }],
      ['get_folder', { folder: '' }],
      ['list_intakes', {}],
      ['get_intake', { intake: 'x' }],
      ['refresh', {}],
    ]
    for (const [name, args] of calls) {
      const result = (await client.callTool({ name, arguments: args })) as any
      expect(result.isError, name).toBe(true)
      expect(result.content[0].text, name).toContain('Settings → Connect AI')
    }
  })

  it('offers the intake_from_photos prompt', async () => {
    const f = await makeContext()
    const client = await connect(f.ctx)
    const prompts = (await client.listPrompts()).prompts
    expect(prompts.map((p) => p.name)).toContain('intake_from_photos')
    const got = await client.getPrompt({ name: 'intake_from_photos', arguments: { folder: '/x' } })
    expect(got.messages).toHaveLength(1)
    expect(got.messages[0]!.role).toBe('user')
    const text = (got.messages[0]!.content as { text: string }).text
    for (const word of ['/x', 'get_overview', 'list_photos', 'view_photos', 'search', 'add_intake_lines', 'onlyNew: true', '`photo`', 'keep showing as new', 'create_folder', 'create_attribute', 'One photo']) expect(text).toContain(word)
    const appended = await client.getPrompt({ name: 'intake_from_photos', arguments: { intake: 'abc' } })
    expect((appended.messages[0]!.content as { text: string }).text).toContain('abc')
  })
})
