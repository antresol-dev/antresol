import {
  FileError,
  isDeleteHandle,
  isPhotoSide,
  MAX_RENDITION_TYPE_LENGTH,
  type FileErrorCode,
  type FileStore,
  type Rendition,
  type StoredFile,
} from '@antresol/core'

export interface ImgbbOptions {
  apiKey: string
  fetch?: typeof fetch
  /** Default 60_000. */
  timeoutMs?: number
  /** Ask ImgBB to delete the image after this many seconds. Only the live test sets it. */
  expirationSeconds?: number
}

export const IMGBB_MEDIUM_SIDE = 640
export const IMGBB_THUMB_SIDE = 180

const UPLOAD_URL = 'https://api.imgbb.com/1/upload'
const PHOTO_PATH = /^\/[A-Za-z0-9]+\/[^/?#]+\.(webp|jpe?g|png|gif)$/i

function codeForStatus(status: number): FileErrorCode {
  if (status === 400 || status === 401 || status === 403) return 'rejected'
  if (status === 413) return 'too_large'
  if (status === 429 || status >= 500) return 'unavailable'
  return 'failed'
}

/** A photo URL on ImgBB: `https://i.ibb.co/<id>/<file>.<ext>`, with no query or fragment (the app appends its cache mark
 *  to these urls). Not even an empty one, which `URL` reports as an empty `search`/`hash`: the text has no `?` or `#`. */
export function isImgbbUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'i.ibb.co' && !u.username && !u.password && !u.port &&
      !/[?#]/.test(url) && PHOTO_PATH.test(u.pathname)
  } catch {
    return false
  }
}

interface ImgbbCopy {
  url?: unknown
  mime?: unknown
}

function toSide(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return isPhotoSide(n) ? n : null
}

/** The size of a `width`×`height` picture fitted inside a `side` square, never enlarged. */
function fitWithin(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

function mimeOf(copy: ImgbbCopy | undefined): string | null {
  return typeof copy?.mime === 'string' && copy.mime && copy.mime.length <= MAX_RENDITION_TYPE_LENGTH ? copy.mime : null
}

function urlOf(copy: ImgbbCopy | undefined): string | null {
  return typeof copy?.url === 'string' && isImgbbUrl(copy.url) ? copy.url : null
}

function toStoredFile(data: Record<string, unknown> | undefined): StoredFile {
  const image = data?.image as ImgbbCopy | undefined
  const id = data?.id
  const url = urlOf(image) ?? (isImgbbUrl(String(data?.url)) ? (data!.url as string) : null)
  const width = toSide(data?.width)
  const height = toSide(data?.height)
  if (typeof id !== 'string' || !id || !url || width === null || height === null) {
    throw new FileError('failed', 'upload failed: unexpected response')
  }

  const urls: Rendition[] = [{ url, role: 'original', width, height, fit: 'inside', type: mimeOf(image) }]
  const mediumUrl = urlOf(data?.medium as ImgbbCopy | undefined)
  if (mediumUrl) {
    urls.push({
      url: mediumUrl,
      role: 'medium',
      ...fitWithin(width, height, IMGBB_MEDIUM_SIDE),
      fit: 'inside',
      type: mimeOf(data?.medium as ImgbbCopy),
    })
  }
  const thumbUrl = urlOf(data?.thumb as ImgbbCopy | undefined)
  if (thumbUrl) {
    urls.push({
      url: thumbUrl,
      role: 'thumb',
      width: IMGBB_THUMB_SIDE,
      height: IMGBB_THUMB_SIDE,
      fit: 'cover',
      type: mimeOf(data?.thumb as ImgbbCopy),
    })
  }

  const deleteUrl = data?.delete_url
  const deleteHandle = isDeleteHandle(deleteUrl) ? deleteUrl : null
  return { provider: 'imgbb', fileId: id, url, urls, deleteHandle }
}

export function createImgbbStore(options: ImgbbOptions): FileStore {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new FileError('no_store')
  const timeoutMs = options.timeoutMs ?? 60_000
  let endpoint = `${UPLOAD_URL}?key=${encodeURIComponent(apiKey)}`
  if (options.expirationSeconds !== undefined) endpoint += `&expiration=${options.expirationSeconds}`

  return {
    provider: 'imgbb',
    async upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile> {
      const doFetch = options.fetch ?? fetch
      const form = new FormData()
      form.append('image', file, name)

      const controller = new AbortController()
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const onAbort = (): void => controller.abort()
      if (signal?.aborted) controller.abort()
      else signal?.addEventListener('abort', onAbort, { once: true })

      try {
        let response: Response
        try {
          response = await doFetch(endpoint, { method: 'POST', body: form, signal: controller.signal })
        } catch {
          // The cause is dropped on purpose: it carries the request URL, which holds the key.
          if (timedOut) throw new FileError('unavailable', 'upload timed out')
          if (signal?.aborted) throw new FileError('failed', 'upload cancelled')
          throw new FileError('unavailable', 'upload failed: network error')
        }
        if (!response.ok) {
          throw new FileError(codeForStatus(response.status), `upload failed: HTTP ${response.status}`)
        }
        let data: Record<string, unknown> | undefined
        try {
          data = ((await response.json()) as { data?: Record<string, unknown> }).data
        } catch {
          throw new FileError('failed', 'upload failed: unreadable response')
        }
        return toStoredFile(data)
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
