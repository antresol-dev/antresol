import type { FileStore } from '@antresol/core'
import { createCloudinaryStore } from '@antresol/files-cloudinary'
import { createImgbbStore } from '@antresol/files-imgbb'
import { createImgurStore } from '@antresol/files-imgur'
import { createUploadcareStore } from '@antresol/files-uploadcare'
import type { ConnectionSettings } from './connection-key'

export type PhotoStore = 'uploadcare' | 'cloudinary' | 'imgbb' | 'imgur'

/** The chosen photo store (Uploadcare by default) when its keys are set; otherwise none. */
export function createFileStore(s: ConnectionSettings, fetchImpl?: typeof fetch): FileStore | null {
  const opts = fetchImpl ? { fetch: fetchImpl } : {}
  if (s.photoStore === 'cloudinary') {
    const cloudName = s.cloudinaryCloudName?.trim()
    const uploadPreset = s.cloudinaryUploadPreset?.trim()
    return cloudName && uploadPreset ? createCloudinaryStore({ cloudName, uploadPreset, ...opts }) : null
  }
  if (s.photoStore === 'imgbb') {
    const apiKey = s.imgbbApiKey?.trim()
    return apiKey ? createImgbbStore({ apiKey, ...opts }) : null
  }
  if (s.photoStore === 'imgur') {
    const clientId = s.imgurClientId?.trim()
    return clientId ? createImgurStore({ clientId, ...opts }) : null
  }
  const key = s.uploadcarePublicKey?.trim()
  return key ? createUploadcareStore({ publicKey: key, cdnBase: s.uploadcareCdnBase ?? undefined, ...opts }) : null
}
