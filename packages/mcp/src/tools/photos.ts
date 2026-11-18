import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { FileError, type DraftLinePhoto, type Id } from '@antresol/core'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ToolContext } from '../context'
import { ToolError, scrub, secretsOf, toToolResult } from '../errors'
import { forModel, forStore } from '../images'
import { createPhotoState, type PhotoState, type StoredUpload } from '../photo-state'

export const PHOTOS_LIMIT = 200
export const VIEW_MAX_PHOTOS = 6
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'])
/** Larger files are refused before they are read (the decoders hold the whole picture in memory). */
const MAX_FILE_BYTES = 100 * 1024 * 1024

// One state per directory for the life of the process: attachPhoto in two calls must see each other's uploads.
const states = new Map<string, PhotoState>()
export function photoState(ctx: ToolContext): PhotoState {
  let s = states.get(ctx.config.stateDir)
  if (!s) {
    s = createPhotoState(ctx.config.stateDir)
    states.set(ctx.config.stateDir, s)
  }
  return s
}

/** The folder to look in: absolute, or relative to the photos folder; the default folder is created when missing. */
async function folderPath(ctx: ToolContext, folder?: string): Promise<string> {
  const base = ctx.config.photosDir
  const dir = folder?.trim() ? path.resolve(base, folder.trim()) : base
  if (dir === base) await mkdir(base, { recursive: true })
  let info
  try {
    info = await stat(dir)
  } catch {
    throw new ToolError(`folder not found: ${dir}`)
  }
  if (!info.isDirectory()) throw new ToolError(`not a folder: ${dir}`)
  return dir
}

export interface PhotoEntry {
  path: string
  name: string
  bytes: number
  modifiedAt: string
  usedIn: { intakeId: Id; lineId: Id } | null
}

export async function listPhotos(
  ctx: ToolContext,
  args: { folder?: string; onlyNew?: boolean } = {},
): Promise<{ folder: string; photos: PhotoEntry[]; more: number }> {
  const folder = await folderPath(ctx, args.folder)
  const used = photoState(ctx).usedPaths()
  const found: (PhotoEntry & { mtime: number })[] = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue
    const full = path.join(folder, entry.name)
    let info
    try {
      info = await stat(full)
    } catch {
      continue
    }
    found.push({
      path: full,
      name: entry.name,
      bytes: info.size,
      modifiedAt: info.mtime.toISOString(),
      usedIn: used.get(full) ?? null,
      mtime: info.mtimeMs,
    })
  }
  const wanted = (args.onlyNew ? found.filter((p) => p.usedIn === null) : found).sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name))
  const photos = wanted.slice(0, PHOTOS_LIMIT).map(({ mtime: _mtime, ...p }) => p)
  return { folder, photos, more: Math.max(0, wanted.length - PHOTOS_LIMIT) }
}

/** The file's bytes; a path that is not absolute is relative to the photos folder. */
async function readPhoto(ctx: ToolContext, file: string): Promise<{ full: string; bytes: Uint8Array }> {
  const full = path.resolve(ctx.config.photosDir, file)
  let info
  try {
    info = await stat(full)
  } catch {
    throw new ToolError(`file not found: ${full}`)
  }
  if (!info.isFile()) throw new ToolError(`not a file: ${full}`)
  if (info.size > MAX_FILE_BYTES) throw new ToolError(`file too large: ${path.basename(full)}`)
  return { full, bytes: await readFile(full) }
}

/** Refuses what attachPhoto would refuse before it uploads (no photo store, a missing or too large file), without uploading: the dry check before any upload. */
export async function checkPhoto(ctx: ToolContext, file: string): Promise<void> {
  if (!ctx.files) throw new ToolError('no photo store: the connection key has no photo store settings. Set up photos in the app and copy the key again.')
  await readPhoto(ctx, file)
}

/** A photo path as the tools accept it, resolved against the photos folder. */
export const resolvePhotoPath = (ctx: ToolContext, file: string): string => path.resolve(ctx.config.photosDir, file)

/** The photos shown to the model: a text block with the path, then the picture, for each. */
export async function viewPhotos(ctx: ToolContext, args: { paths: string[] }): Promise<CallToolResult> {
  try {
    if (args.paths.length < 1 || args.paths.length > VIEW_MAX_PHOTOS) throw new ToolError(`pass from 1 to ${VIEW_MAX_PHOTOS} paths, got ${args.paths.length}`)
    const content: CallToolResult['content'] = []
    for (const file of args.paths) {
      const { full, bytes } = await readPhoto(ctx, file)
      const shown = await forModel(bytes, path.basename(full))
      content.push({ type: 'text', text: full }, { type: 'image', data: shown.data, mimeType: shown.mimeType })
    }
    return { content }
  } catch (e) {
    return toToolResult(e, secretsOf(ctx.config))
  }
}

/** What an upload is remembered under: the photo store (provider plus a short hash of its settings, never the keys in
 *  clear) and the content, so another store or source never reuses this store's URL. */
export function uploadKey(ctx: ToolContext, sha: string): string {
  const c = ctx.config.connection
  const settings = c ? [c.photoStore, c.uploadcarePublicKey, c.uploadcareCdnBase, c.cloudinaryCloudName, c.cloudinaryUploadPreset, c.imgurClientId, c.imgbbApiKey] : []
  const store = createHash('sha256').update(JSON.stringify([ctx.files?.provider ?? null, ...settings])).digest('hex').slice(0, 12)
  return `${ctx.files?.provider ?? 'none'}:${store}:${sha}`
}

// Uploads in progress by content: parallel calls for the same picture share one upload.
const inFlight = new Map<string, Promise<StoredUpload>>()

/**
 * The file as a photo for a draft line. The same content is uploaded once, whichever path it comes from, also when calls
 * run in parallel. Nothing is marked as used here: call `markPhotoUsed` once the line is saved.
 */
export async function attachPhoto(ctx: ToolContext, file: string): Promise<DraftLinePhoto> {
  const files = ctx.files
  if (!files) throw new ToolError('no photo store: the connection key has no photo store settings. Set up photos in the app and copy the key again.')
  const { full, bytes } = await readPhoto(ctx, file)
  const state = photoState(ctx)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const stateKey = uploadKey(ctx, sha)
  let upload = state.get(stateKey)
  if (!upload) {
    const key = `${ctx.config.stateDir}\0${stateKey}`
    let pending = inFlight.get(key)
    if (!pending) {
      pending = (async () => {
        const prepared = await forStore(bytes, path.basename(full))
        let stored
        try {
          stored = await files.upload(prepared.blob, prepared.name)
        } catch (e) {
          if (e instanceof FileError) throw e
          throw new ToolError(`the photo store did not take ${path.basename(full)}: ${e instanceof Error ? e.message : String(e)}`)
        }
        const made = { ...stored, width: prepared.width, height: prepared.height }
        state.put(stateKey, made)
        return made
      })().finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    upload = await pending
  }
  return {
    provider: upload.provider,
    fileId: upload.fileId,
    url: upload.url,
    urls: upload.urls ?? null,
    deleteHandle: upload.deleteHandle ?? null,
    width: upload.width,
    height: upload.height,
    replace: false,
  }
}

/**
 * The pictures now belong to saved draft lines: list_photos shows them as used. Advisory: the draft is already saved, so a
 * failure to write the state is returned as a warning text, never thrown (a retry would add the lines twice).
 */
export function markPhotosUsed(ctx: ToolContext, entries: { file: string; intakeId: Id; lineId: Id }[]): string | null {
  try {
    photoState(ctx).markUsed(entries.map((e) => ({ path: resolvePhotoPath(ctx, e.file), intakeId: e.intakeId, lineId: e.lineId })))
    return null
  } catch (e) {
    return `The lines were saved, but list_photos may not show their pictures as used (${scrub(e instanceof Error ? e.message : String(e), secretsOf(ctx.config))}).`
  }
}
