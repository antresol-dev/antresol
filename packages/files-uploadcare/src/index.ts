import { FileError, type FileErrorCode, type FileStore, type StoredFile } from '@antresol/core'

export interface UploadcareOptions {
  publicKey: string
  /**
   * CDN base for the returned URL; the Upload API returns only the file UUID. Default 'https://ucarecdn.com', which is
   * right for projects created before 2025-09-04; newer projects are delivered from their own `<id>.ucarecd.net`.
   * Must satisfy isUploadcareCdnBase, otherwise upload() rejects with 'no_store'.
   */
  cdnBase?: string
  fetch?: typeof fetch
  /** Default 60_000. */
  timeoutMs?: number
}

const UPLOAD_URL = 'https://upload.uploadcare.com/base/'
const DEFAULT_CDN = 'https://ucarecdn.com'

function codeForStatus(status: number): FileErrorCode {
  if (status === 400 || status === 403) return 'rejected'
  if (status === 413) return 'too_large'
  if (status === 429 || status >= 500) return 'unavailable'
  return 'failed'
}

function parseHttps(url: string): URL | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port ? u : null
  } catch {
    return null
  }
}

function isUploadcareHost(hostname: string): boolean {
  if (hostname === 'ucarecdn.com') return true
  return hostname.endsWith('.ucarecd.net') && hostname.length > '.ucarecd.net'.length
}

/** A photo URL (with a path) on an Uploadcare delivery host: `https://ucarecdn.com` or `https://<sub>.ucarecd.net`. */
export function isUploadcareUrl(url: string): boolean {
  const u = parseHttps(url)
  return u !== null && isUploadcareHost(u.hostname)
}

/** The one rule for a CDN base: an Uploadcare delivery host over https, with no path, query or fragment
 *  (trailing slashes are tolerated). Custom CNAME domains are not accepted: the app never displays their photos. */
export function isUploadcareCdnBase(url: string): boolean {
  if (/[?#]/.test(url)) return false
  const u = parseHttps(url)
  return u !== null && isUploadcareHost(u.hostname) && /^\/*$/.test(u.pathname)
}

export function createUploadcareStore(options: UploadcareOptions): FileStore {
  const publicKey = options.publicKey.trim()
  if (!publicKey) throw new FileError('no_store')
  const cdnBase = (options.cdnBase?.trim() || DEFAULT_CDN).replace(/\/+$/, '')
  const cdnOk = isUploadcareCdnBase(cdnBase)
  const timeoutMs = options.timeoutMs ?? 60_000

  return {
    provider: 'uploadcare',
    async upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile> {
      // A bad base would be baked into every stored photo URL: refuse before anything is sent.
      if (!cdnOk) throw new FileError('no_store', 'invalid CDN base')
      const doFetch = options.fetch ?? fetch
      const form = new FormData()
      form.append('UPLOADCARE_PUB_KEY', publicKey)
      form.append('UPLOADCARE_STORE', '1')
      form.append('file', file, name)

      // AbortSignal.timeout / any are missing in older browsers: a plain controller.
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
          response = await doFetch(UPLOAD_URL, { method: 'POST', body: form, signal: controller.signal })
        } catch {
          // The cause is dropped on purpose: it may carry the request details.
          if (timedOut) throw new FileError('unavailable', 'upload timed out')
          if (signal?.aborted) throw new FileError('failed', 'upload cancelled')
          throw new FileError('unavailable', 'upload failed: network error')
        }
        if (!response.ok) {
          throw new FileError(codeForStatus(response.status), `upload failed: HTTP ${response.status}`)
        }
        let uuid: unknown
        try {
          uuid = ((await response.json()) as { file?: unknown }).file
        } catch {
          throw new FileError('failed', 'upload failed: unreadable response')
        }
        if (typeof uuid !== 'string' || !uuid) throw new FileError('failed', 'upload failed: no file id in response')
        return { provider: 'uploadcare', fileId: uuid, url: `${cdnBase}/${uuid}/` }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
