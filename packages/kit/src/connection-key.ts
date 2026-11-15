import type { PhotoStore } from './file-store'

/** What a source's connection takes: a database and, optionally, the photo store. No id, no creation time. */
export type ConnectionSettings = {
  name: string
  connectionString: string
  photoStore?: PhotoStore
  uploadcarePublicKey?: string | null
  uploadcareCdnBase?: string | null
  cloudinaryCloudName?: string | null
  cloudinaryUploadPreset?: string | null
  imgurClientId?: string | null
  imgbbApiKey?: string | null
}

export const CONNECTION_KEY_PREFIX = 'antresol-connect-v1:'

const STORES: readonly string[] = ['uploadcare', 'cloudinary', 'imgbb', 'imgur']
const OPTIONAL = [
  'uploadcarePublicKey',
  'uploadcareCdnBase',
  'cloudinaryCloudName',
  'cloudinaryUploadPreset',
  'imgurClientId',
  'imgbbApiKey',
] as const

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0))
}

/** The settings as a text to paste: prefix + base64url JSON. Empty optional values are left out. */
export function encodeConnectionKey(s: ConnectionSettings): string {
  const out: Record<string, unknown> = { name: s.name, connectionString: s.connectionString }
  if (s.photoStore) out.photoStore = s.photoStore
  for (const key of OPTIONAL) {
    const value = s[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return CONNECTION_KEY_PREFIX + toBase64Url(new TextEncoder().encode(JSON.stringify(out)))
}

/** Throws an Error whose message never contains the key's content. */
export function decodeConnectionKey(text: string): ConnectionSettings {
  const trimmed = text.trim()
  if (!trimmed.startsWith(CONNECTION_KEY_PREFIX)) throw new Error('Not an Antresol connection key (wrong prefix).')
  const body = trimmed.slice(CONNECTION_KEY_PREFIX.length)
  let data: unknown
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('bad')
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(body)))
  } catch {
    throw new Error('The connection key is damaged: it could not be read.')
  }
  if (typeof data !== 'object' || data === null) throw new Error('The connection key has no settings.')
  const d = data as Record<string, unknown>
  if (typeof d.connectionString !== 'string') throw new Error('The connection key has no connection string.')
  if (!/^postgres(ql)?:\/\//.test(d.connectionString)) throw new Error('The connection string in the key is not a postgres:// address.')
  const out: ConnectionSettings = { name: typeof d.name === 'string' ? d.name : '', connectionString: d.connectionString }
  if (d.photoStore !== undefined) {
    if (typeof d.photoStore !== 'string' || !STORES.includes(d.photoStore)) throw new Error('The connection key names an unknown photo store.')
    out.photoStore = d.photoStore as PhotoStore
  }
  for (const key of OPTIONAL) if (typeof d[key] === 'string') out[key] = d[key]
  return out
}
