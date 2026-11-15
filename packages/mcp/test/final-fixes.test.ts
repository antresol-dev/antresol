import { copyFile, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { StorageError, type FileStore, type InventoryStorage } from '@antresol/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { ensureOpen, OPEN_RETRY_MS, type ToolContext } from '../src/context'
import { toToolResult } from '../src/errors'
import { createPhotoState } from '../src/photo-state'
import { createServer } from '../src/server'
import * as drafts from '../src/tools/drafts'
import { attachPhoto, uploadKey } from '../src/tools/photos'
import pkg from '../package.json'
import { disconnectedContext, makeContext } from './fixture'

const FIXTURES = path.join(__dirname, 'fixtures')

describe('ensureOpen (I1)', () => {
  it('retries a failed open after the interval and clears the error', async () => {
    const f = await makeContext()
    let t = 0
    const ctx: ToolContext = { ...disconnectedContext(), now: () => new Date(t) }
    let calls = 0
    ctx.openStorage = async () => {
      calls++
      if (calls === 1) throw new StorageError('unavailable')
      return f.storage
    }
    await ensureOpen(ctx)
    expect(ctx.source).toBeNull()
    expect(ctx.openError).toBeInstanceOf(StorageError)
    t += 1000
    await ensureOpen(ctx)
    expect(calls).toBe(1)
    t += OPEN_RETRY_MS
    await ensureOpen(ctx)
    expect(calls).toBe(2)
    expect(ctx.source).not.toBeNull()
    expect(ctx.openError).toBeUndefined()
  })

  it('does not retry without a key and shares concurrent attempts', async () => {
    const ctx = disconnectedContext()
    await ensureOpen(ctx)
    expect(ctx.source).toBeNull()
    const f = await makeContext()
    const open = vi.fn(async () => f.storage)
    const c2: ToolContext = { ...disconnectedContext(), openStorage: open }
    await Promise.all([ensureOpen(c2), ensureOpen(c2)])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('a tool call through the protocol opens a database that was down at start', async () => {
    const f = await makeContext()
    let t = 0
    const ctx: ToolContext = { ...disconnectedContext(), now: () => new Date(t) }
    let calls = 0
    ctx.openStorage = async () => {
      if (++calls === 1) throw new StorageError('unavailable')
      return f.storage
    }
    const server = createServer(ctx)
    const client = new Client({ name: 'T', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    const first = (await client.callTool({ name: 'get_overview', arguments: {} })) as any
    expect(first.isError).toBe(true)
    t += OPEN_RETRY_MS
    const second = (await client.callTool({ name: 'get_overview', arguments: {} })) as any
    expect(second.isError).toBeFalsy()
  })
})

describe('writes and the snapshot (I2)', () => {
  it('add_intake_lines loads no inventory snapshot when rev is unchanged and the cache is warm', async () => {
    const f = await makeContext()
    const created = (await drafts.createIntake(f.ctx, { shop: 'X' })) as any
    await f.source.snapshot(f.inventoryId)
    const load = vi.spyOn(f.storage as InventoryStorage, 'loadInventoryWithRev')
    await drafts.addIntakeLines(f.ctx, { intake: created.id, lines: [{ item: f.ids.resistor, values: { Resistance: '4k7' }, amount: '1' }] })
    expect(load).toHaveBeenCalledTimes(0)
  })
})

describe('PhotoState shared between processes (I3)', () => {
  it('two instances see each other, and a corrupt file is moved aside once', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'antresol-state-'))
    const a = createPhotoState(dir)
    const b = createPhotoState(dir)
    const up = { provider: 'p', fileId: 'f', url: 'u', width: 1, height: 1 }
    a.put('k1', up)
    b.put('k2', { ...up, fileId: 'g' })
    a.markUsed([{ path: '/x', intakeId: 'i', lineId: 'l' }])
    b.markUsed([{ path: '/y', intakeId: 'i', lineId: 'm' }])
    expect(a.get('k2')).toMatchObject({ fileId: 'g' })
    expect(b.get('k1')).toMatchObject({ fileId: 'f' })
    expect([...a.usedPaths().keys()].sort()).toEqual(['/x', '/y'])

    await writeFile(path.join(dir, 'mcp-photos.json'), '{broken')
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(a.usedPaths().size).toBe(0)
    expect(err).toHaveBeenCalledTimes(1)
    expect((await readdir(dir)).some((n) => n.startsWith('mcp-photos.corrupt-'))).toBe(true)
    expect(a.get('k1')).toBeNull()
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})

describe('upload cache by store (M3)', () => {
  it('another photo store does not reuse an upload', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'antresol-photos-'))
    const photosDir = path.join(root, 'photos')
    await mkdir(photosDir)
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'a.png'))
    const store = (provider: string): FileStore => ({
      provider: provider as any,
      upload: async () => ({ provider: provider as any, fileId: provider, url: `https://${provider}/1`, urls: null, deleteHandle: null }),
    })
    const base: ToolContext = { ...disconnectedContext(), config: { ...disconnectedContext().config, photosDir, stateDir: path.join(root, 's') } }
    const one = await attachPhoto({ ...base, files: store('one') }, 'a.png')
    const two = await attachPhoto({ ...base, files: store('two') }, 'a.png')
    expect(one.url).toBe('https://one/1')
    expect(two.url).toBe('https://two/1')
    expect(uploadKey({ ...base, files: store('one') }, 'abc')).not.toBe(uploadKey({ ...base, files: store('two') }, 'abc'))
  })
})

describe('refusals before uploads (M1)', () => {
  it('a committed or unknown intake or a missing connection is refused before the photo store is touched', async () => {
    const f = await makeContext()
    const upload = vi.fn(async () => ({ provider: 'x' as any, fileId: 'f', url: 'u', urls: null, deleteHandle: null }))
    const root = await mkdtemp(path.join(os.tmpdir(), 'antresol-photos-'))
    const photosDir = path.join(root, 'photos')
    await mkdir(photosDir)
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'a.png'))
    const ctx: ToolContext = { ...f.ctx, files: { provider: 'x' as any, upload }, config: { ...f.ctx.config, photosDir, stateDir: path.join(root, 's') } }
    await expect(drafts.addIntakeLines(ctx, { intake: 'nope', lines: [{ item: f.ids.resistor, amount: '1', photo: 'a.png' }] })).rejects.toThrow(/No intake/)
    await expect(drafts.updateIntakeLine(ctx, { intake: 'nope', line: 'l', photo: 'a.png' })).rejects.toThrow(/No intake/)
    expect(upload).not.toHaveBeenCalled()

    const disconnected: ToolContext = { ...disconnectedContext(), files: null }
    await expect(drafts.addIntakeLines(disconnected, { intake: 'x', lines: [{ item: 'i', amount: '1', photo: 'a.png' }] })).rejects.toThrow(/Connect AI/)
  })
})

describe('write timeouts (M2)', () => {
  it('say the change may have been saved', () => {
    const e = new StorageError('unavailable')
    expect((toToolResult(e, [], { write: true }).content[0] as any).text).toMatch(/may have been saved.*get_intake/)
    expect((toToolResult(e, []).content[0] as any).text).toMatch(/not reachable/)
  })
})

describe('server version (M6)', () => {
  it('is the package version', async () => {
    const server = createServer(disconnectedContext())
    const client = new Client({ name: 'T', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    expect(client.getServerVersion()?.version).toBe(pkg.version)
  })
})

