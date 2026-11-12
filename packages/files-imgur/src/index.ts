import { FileError, type FileErrorCode, type FileStore, type StoredFile } from '@antresol/core'

export interface ImgurOptions {
  /** The Client-ID of an Imgur application (anonymous upload). */
  clientId: string
  fetch?: typeof fetch
  /** Default 60_000. */
  timeoutMs?: number
}

const UPLOAD_URL = 'https://api.imgur.com/3/image'
const PHOTO_PATH = /^\/([A-Za-z0-9]+)\.(jpe?g|png|gif|webp)$/i

function codeForStatus(status: number): FileErrorCode {
  if (status === 400 || status === 401 || status === 403) return 'rejected'
  if (status === 413) return 'too_large'
  if (status === 429 || status >= 500) return 'unavailable'
  return 'failed'
}

/** A photo URL on Imgur: `https://i.imgur.com/<id>.<ext>` (no size suffix). */
export function isImgurUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'i.imgur.com' && !u.username && !u.password && !u.port &&
      PHOTO_PATH.test(u.pathname)
  } catch {
    return false
  }
}

/** Thumbnail by a size letter before the extension (`s` 90, `t` 160, `m` 320, `l` 640, `h` 1024); other URLs unchanged. */
export function imgurThumbUrl(url: string, size: 's' | 't' | 'm' | 'l' | 'h'): string {
  if (!isImgurUrl(url)) return url
  const u = new URL(url)
  const m = PHOTO_PATH.exec(u.pathname)!
  return `https://i.imgur.com/${m[1]}${size}.${m[2]}`
}

export function createImgurStore(options: ImgurOptions): FileStore {
  const clientId = options.clientId.trim()
  if (!clientId) throw new FileError('no_store')
  const timeoutMs = options.timeoutMs ?? 60_000

  return {
    provider: 'imgur',
    async upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile> {
      const doFetch = options.fetch ?? fetch
      const form = new FormData()
      form.append('image', file, name)
      form.append('type', 'file')

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
          response = await doFetch(UPLOAD_URL, {
            method: 'POST',
            body: form,
            headers: { Authorization: `Client-ID ${clientId}` },
            signal: controller.signal,
          })
        } catch {
          // The cause is dropped on purpose: it may carry the request details.
          if (timedOut) throw new FileError('unavailable', 'upload timed out')
          if (signal?.aborted) throw new FileError('failed', 'upload cancelled')
          throw new FileError('unavailable', 'upload failed: network error')
        }
        if (!response.ok) {
          throw new FileError(codeForStatus(response.status), `upload failed: HTTP ${response.status}`)
        }
        let data: { id?: unknown; link?: unknown } | undefined
        try {
          data = ((await response.json()) as { data?: { id?: unknown; link?: unknown } }).data
        } catch {
          throw new FileError('failed', 'upload failed: unreadable response')
        }
        const id = data?.id
        const link = typeof data?.link === 'string' ? data.link.replace(/^http:/, 'https:') : ''
        if (typeof id !== 'string' || !id || !isImgurUrl(link)) {
          throw new FileError('failed', 'upload failed: unexpected response')
        }
        return { provider: 'imgur', fileId: id, url: link }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
