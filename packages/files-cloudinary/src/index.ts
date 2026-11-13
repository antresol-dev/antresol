import { FileError, type FileErrorCode, type FileStore, type StoredFile } from '@antresol/core'

export interface CloudinaryOptions {
  cloudName: string
  /** An unsigned upload preset of the Cloudinary account (Settings → Upload → Upload presets). */
  uploadPreset: string
  fetch?: typeof fetch
  /** Default 60_000. */
  timeoutMs?: number
}

const CLOUD_NAME = /^[A-Za-z0-9_-]+$/

function codeForStatus(status: number): FileErrorCode {
  if (status === 400 || status === 401 || status === 403) return 'rejected'
  if (status === 413) return 'too_large'
  if (status === 420 || status === 429 || status >= 500) return 'unavailable'
  return 'failed'
}

/** A photo URL on Cloudinary delivery: `https://res.cloudinary.com/<cloud>/image/upload/…`. */
export function isCloudinaryUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && !u.username && !u.password && !u.port &&
      /^\/[^/]+\/image\/upload\/./.test(u.pathname)
  } catch {
    return false
  }
}

/** Thumbnail by a transformation inserted right after `/upload/`; other URLs unchanged. */
export function cloudinaryThumbUrl(url: string, side: number): string {
  if (!isCloudinaryUrl(url)) return url
  return url.replace('/image/upload/', `/image/upload/w_${side},c_limit,f_auto,q_auto/`)
}

export function createCloudinaryStore(options: CloudinaryOptions): FileStore {
  const cloudName = options.cloudName.trim()
  const uploadPreset = options.uploadPreset.trim()
  if (!cloudName || !uploadPreset || !CLOUD_NAME.test(cloudName)) throw new FileError('no_store')
  const timeoutMs = options.timeoutMs ?? 60_000
  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`

  return {
    provider: 'cloudinary',
    async upload(file: Blob, name: string, signal?: AbortSignal): Promise<StoredFile> {
      const doFetch = options.fetch ?? fetch
      const form = new FormData()
      form.append('upload_preset', uploadPreset)
      form.append('file', file, name)

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
          // The cause is dropped on purpose: it may carry the request details.
          if (timedOut) throw new FileError('unavailable', 'upload timed out')
          if (signal?.aborted) throw new FileError('failed', 'upload cancelled')
          throw new FileError('unavailable', 'upload failed: network error')
        }
        if (!response.ok) {
          throw new FileError(codeForStatus(response.status), `upload failed: HTTP ${response.status}`)
        }
        let body: { public_id?: unknown; secure_url?: unknown; existing?: unknown }
        try {
          body = (await response.json()) as typeof body
        } catch {
          throw new FileError('failed', 'upload failed: unreadable response')
        }
        // Every upload is named photo.<ext>: a preset that keeps file names without making them unique answers with the
        // asset it already has under that name, another picture.
        if (body.existing === true) throw new FileError('rejected', 'upload refused: the preset returned an existing image')
        const { public_id: publicId, secure_url: url } = body
        if (typeof publicId !== 'string' || !publicId || typeof url !== 'string' || !isCloudinaryUrl(url)) {
          throw new FileError('failed', 'upload failed: unexpected response')
        }
        return { provider: 'cloudinary', fileId: publicId, url }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
    },
  }
}
