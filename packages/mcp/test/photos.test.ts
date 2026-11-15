import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { newId, type FileStore } from '@antresol/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config'
import type { ToolContext } from '../src/context'
import { ToolError } from '../src/errors'
import { createPhotoState } from '../src/photo-state'
import { createServer } from '../src/server'
import { attachPhoto, listPhotos, viewPhotos } from '../src/tools/photos'
import * as drafts from '../src/tools/drafts'
import * as read from '../src/tools/read'
import { makeContext, TEST_ACTOR } from './fixture'

const FIXTURES = path.join(__dirname, 'fixtures')

async function setup(files: FileStore | null = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'antresol-photos-'))
  const photosDir = path.join(root, 'photos')
  const stateDir = path.join(root, 'state')
  await mkdir(photosDir)
  const config = readConfig({ ANTRESOL_PHOTOS_DIR: photosDir }, 'linux', root)
  const ctx: ToolContext = { source: null, storage: null, config: { ...config, stateDir }, actor: () => TEST_ACTOR, files, now: () => new Date() }
  return { root, photosDir, stateDir, ctx }
}

function fakeStore() {
  const uploads: { name: string; type: string; size: number }[] = []
  const files: FileStore = {
    provider: 'fake',
    async upload(blob, name) {
      uploads.push({ name, type: blob.type, size: blob.size })
      return { provider: 'fake', fileId: `f${uploads.length}`, url: `https://img.example/${uploads.length}`, urls: null, deleteHandle: `h${uploads.length}` }
    },
  }
  return { files, uploads }
}

describe('listPhotos', () => {
  it('shows pictures by extension (any case), newest first, and not other files', async () => {
    const { ctx, photosDir } = await setup()
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'IMG.JPG'))
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'old.png'))
    await writeFile(path.join(photosDir, 'notes.txt'), 'x')
    await utimes(path.join(photosDir, 'old.png'), new Date('2020-01-01'), new Date('2020-01-01'))
    const out = await listPhotos(ctx, {})
    expect(out.folder).toBe(photosDir)
    expect(out.photos.map((p) => p.name)).toEqual(['IMG.JPG', 'old.png'])
    expect(out.photos[0]).toMatchObject({ path: path.join(photosDir, 'IMG.JPG'), bytes: 6310, usedIn: null })
    expect(out.more).toBe(0)
  })

  it('creates a missing default photos folder', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'antresol-photos-'))
    const config = readConfig({ ANTRESOL_PHOTOS_DIR: path.join(root, 'Pictures', 'Antresol') }, 'linux', root)
    const ctx: ToolContext = { source: null, storage: null, config, actor: () => TEST_ACTOR, files: null, now: () => new Date() }
    expect((await listPhotos(ctx, {})).photos).toEqual([])
    const again = await listPhotos(ctx, { folder: 'nope' }).catch((e: unknown) => e)
    expect(again).toBeInstanceOf(ToolError)
  })
})

describe('attachPhoto', () => {
  it('uploads one file content once, also under another name and in a second line, and listPhotos shows usedIn', async () => {
    const { files, uploads } = fakeStore()
    const { ctx, photosDir, stateDir } = await setup(files)
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'a.png'))
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'copy.png'))
    const first = await attachPhoto(ctx, 'a.png', 'intake-1', 'line-1')
    const second = await attachPhoto(ctx, path.join(photosDir, 'copy.png'), 'intake-1', 'line-2')
    const third = await attachPhoto(ctx, 'a.png', 'intake-1', 'line-3')
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ name: 'photo.webp', type: 'image/webp' })
    expect(first).toEqual({ provider: 'fake', fileId: 'f1', url: 'https://img.example/1', urls: null, deleteHandle: 'h1', width: 64, height: 48, replace: false })
    expect(second).toEqual(first)
    expect(third).toEqual(first)

    const listed = await listPhotos(ctx, {})
    expect(listed.photos.find((p) => p.name === 'a.png')?.usedIn).toEqual({ intakeId: 'intake-1', lineId: 'line-1' })
    expect(listed.photos.find((p) => p.name === 'copy.png')?.usedIn).toBeNull()
    expect((await listPhotos(ctx, { onlyNew: true })).photos.map((p) => p.name)).toEqual(['copy.png'])

    // The state lives in the file, not only in memory.
    const reopened = createPhotoState(stateDir)
    expect(reopened.usedPaths().get(path.join(photosDir, 'a.png'))).toEqual({ intakeId: 'intake-1', lineId: 'line-1' })
    const sha = createHash('sha256').update(await readFile(path.join(FIXTURES, 'gradient.png'))).digest('hex')
    expect(reopened.get(sha)).toMatchObject({ fileId: 'f1', width: 64 })
  })

  it('without a photo store it says so', async () => {
    const { ctx, photosDir } = await setup(null)
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'a.png'))
    const error = await attachPhoto(ctx, 'a.png', 'i', 'l').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as Error).message).toMatch(/^no photo store/)
  })

  it('a missing file and a text file named .jpg are errors that name the file', async () => {
    const { files } = fakeStore()
    const { ctx, photosDir } = await setup(files)
    await writeFile(path.join(photosDir, 'notes.jpg'), 'text')
    expect(await attachPhoto(ctx, 'gone.jpg', 'i', 'l').catch((e: unknown) => (e as Error).message)).toBe(`file not found: ${path.join(photosDir, 'gone.jpg')}`)
    expect(await attachPhoto(ctx, 'notes.jpg', 'i', 'l').catch((e: unknown) => (e as Error).message)).toBe('not an image this server can read: notes.jpg')
  })
})

describe('view_photos through the server', () => {
  async function connect(ctx: ToolContext) {
    const server = createServer(ctx)
    const client = new Client({ name: 'test', version: '1' })
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    return client
  }

  it('shows each picture after its path; 7 paths, a missing file and a text file are errors and the server keeps answering', async () => {
    const { ctx, photosDir } = await setup()
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(photosDir, 'a.png'))
    await copyFile(path.join(FIXTURES, 'gradient.heic'), path.join(photosDir, 'b.heic'))
    await writeFile(path.join(photosDir, 'notes.jpg'), 'text')
    const client = await connect(ctx)

    const two = await client.callTool({ name: 'view_photos', arguments: { paths: ['a.png', 'b.heic'] } })
    const blocks = two.content as { type: string; text?: string; mimeType?: string; data?: string }[]
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text', 'image'])
    expect(blocks[0]!.text).toBe(path.join(photosDir, 'a.png'))
    expect(blocks[1]!.mimeType).toBe('image/jpeg')
    expect(blocks[1]!.data!.length).toBeGreaterThan(100)

    const seven = await client.callTool({ name: 'view_photos', arguments: { paths: Array(7).fill('a.png') } })
    expect(seven.isError).toBe(true)
    const text = await client.callTool({ name: 'view_photos', arguments: { paths: ['notes.jpg'] } })
    expect(text.isError).toBe(true)
    expect((text.content as { text: string }[])[0]!.text).toContain('notes.jpg')
    const missing = await client.callTool({ name: 'view_photos', arguments: { paths: ['gone.png'] } })
    expect((missing.content as { text: string }[])[0]!.text).toContain('file not found')

    const listed = await client.callTool({ name: 'list_photos', arguments: {} })
    expect(listed.isError).toBeFalsy()
    expect(JSON.parse((listed.content as { text: string }[])[0]!.text).photos).toHaveLength(3)
  })

  it('viewPhotos rejects an empty list', async () => {
    const { ctx } = await setup()
    expect((await viewPhotos(ctx, { paths: [] })).isError).toBe(true)
  })
})

describe('photo in draft lines', () => {
  async function draftSetup(withStore: boolean) {
    const { files, uploads } = fakeStore()
    const s = await setup(withStore ? files : null)
    await copyFile(path.join(FIXTURES, 'gradient.png'), path.join(s.photosDir, 'a.png'))
    const f = await makeContext()
    const ctx: ToolContext = { ...f.ctx, config: s.ctx.config, files: s.ctx.files }
    const id = ((await drafts.createIntake(ctx, { shop: 'LCSC' })) as any).id as string
    return { ...s, f, ctx, id, uploads }
  }

  it('one upload for the same file in two lines and in two calls; usedIn afterwards; photo is on the line', async () => {
    const { ctx, id, f, uploads } = await draftSetup(true)
    let v = (await drafts.addIntakeLines(ctx, {
      intake: id,
      lines: [
        { item: f.ids.esp32, amount: '1', photo: 'a.png' },
        { item: f.ids.esp32, amount: '2', photo: 'a.png' },
      ],
    })) as any
    v = (await drafts.addIntakeLines(ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '3', photo: 'a.png' }] })) as any
    expect(uploads).toHaveLength(1)
    expect(v.lines.map((l: any) => l.photo?.url)).toEqual(Array(3).fill('https://img.example/1'))
    expect(v.lines[0].photo.replace).toBe(false)
    const listed = await listPhotos(ctx, {})
    expect(listed.photos[0]!.usedIn).toEqual({ intakeId: id, lineId: v.lines[0].id })
  })

  it('replacePhoto sets replace; update sets, keeps and removes (empty) the photo', async () => {
    const { ctx, id, f, uploads } = await draftSetup(true)
    let v = (await drafts.addIntakeLines(ctx, { intake: id, lines: [{ item: f.ids.resistor, values: { Resistance: '4k7' }, amount: '1' }] })) as any
    const line = v.lines[0].id as string
    expect(v.lines[0].photo).toBeNull()
    // The variant has no photo in stock: "replace" has nothing to replace and is dropped.
    v = (await drafts.updateIntakeLine(ctx, { intake: id, line, photo: 'a.png', replacePhoto: true })) as any
    expect(v.lines[0].photo).toMatchObject({ url: 'https://img.example/1', replace: false })
    await f.apply({ type: 'photo.add', id: newId(), itemId: f.ids.resistor, variantId: f.ids.v4k7, provider: 'x', fileId: 'x', url: 'https://x/1' })
    ctx.source!.refresh()
    v = (await drafts.updateIntakeLine(ctx, { intake: id, line, photo: 'a.png', replacePhoto: true })) as any
    expect(v.lines[0].photo).toMatchObject({ url: 'https://img.example/1', replace: true })
    v = (await drafts.updateIntakeLine(ctx, { intake: id, line, amount: '4' })) as any
    expect(v.lines[0].photo).toMatchObject({ url: 'https://img.example/1' })
    v = (await drafts.updateIntakeLine(ctx, { intake: id, line, photo: '' })) as any
    expect(v.lines[0].photo).toBeNull()
    expect(uploads).toHaveLength(1)
    expect((await read.getIntake(ctx, { intake: id }) as any).lines[0].photo).toBeNull()
  })

  it('without a photo store a line with a photo is refused and lines without photos still save', async () => {
    const { ctx, id, f } = await draftSetup(false)
    const error = await drafts.addIntakeLines(ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1', photo: 'a.png' }] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ToolError)
    expect((error as Error).message).toContain('no photo store')
    expect(((await read.getIntake(ctx, { intake: id })) as any).lines).toHaveLength(0)
    const v = (await drafts.addIntakeLines(ctx, { intake: id, lines: [{ item: f.ids.esp32, amount: '1' }] })) as any
    expect(v.lines).toHaveLength(1)
  })
})
