import { checkConnectionString } from './sources'
import type { PhotoStore, SourceConfig } from './types'

/** A source's settings handed from one device to another by a QR code (Settings → Share → scan on the phone). Only
 *  what the new-source form takes: no id, no creation time. */
export type SharedConnection = Pick<SourceConfig, 'name' | 'connectionString'> &
  Partial<
    Pick<
      SourceConfig,
      | 'photoStore'
      | 'uploadcarePublicKey'
      | 'uploadcareCdnBase'
      | 'cloudinaryCloudName'
      | 'cloudinaryUploadPreset'
      | 'imgurClientId'
      | 'imgbbApiKey'
    >
  >

/** The fragment parameter that carries it: `…/settings/sources/new#connect=<base64url JSON>`. A fragment never reaches
 *  a server, so the address can be opened by the phone's own camera app too. */
export const CONNECT_PARAM = 'connect'
const VERSION = 1
const STORES: readonly PhotoStore[] = ['uploadcare', 'cloudinary', 'imgbb', 'imgur']
const OPTIONAL = [
  'uploadcarePublicKey',
  'uploadcareCdnBase',
  'cloudinaryCloudName',
  'cloudinaryUploadPreset',
  'imgurClientId',
  'imgbbApiKey',
] as const

function toBase64Url(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

/** The connection as the fragment value; empty settings are left out to keep the QR code small. */
export function encodeConnection(source: SourceConfig | SharedConnection): string {
  const out: Record<string, unknown> = { v: VERSION, name: source.name, connectionString: source.connectionString }
  if (source.photoStore) out.photoStore = source.photoStore
  for (const key of OPTIONAL) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return toBase64Url(JSON.stringify(out))
}

/** The address the QR code holds: this app's new-source page (under `base`, e.g. `https://host/antresol/`). */
export function connectionLink(base: string, source: SourceConfig | SharedConnection): string {
  return `${base.replace(/\/*$/, '/')}settings/sources/new#${CONNECT_PARAM}=${encodeConnection(source)}`
}

/** A scanned text or a page fragment → the connection; null for anything else (another QR code, a broken one, a
 *  newer format, a connection string the form would refuse). */
export function readConnection(text: string): SharedConnection | null {
  const match = new RegExp(`(?:^|[#&?])${CONNECT_PARAM}=([A-Za-z0-9_-]+)`).exec(text.trim())
  if (!match) return null
  let data: unknown
  try {
    data = JSON.parse(fromBase64Url(match[1]!))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (d.v !== VERSION || typeof d.name !== 'string' || typeof d.connectionString !== 'string') return null
  if (checkConnectionString(d.connectionString) !== null) return null
  const out: SharedConnection = { name: d.name, connectionString: d.connectionString }
  if (typeof d.photoStore === 'string' && (STORES as readonly string[]).includes(d.photoStore)) out.photoStore = d.photoStore as PhotoStore
  for (const key of OPTIONAL) if (typeof d[key] === 'string') out[key] = d[key]
  return out
}

declare global {
  /** The Shape Detection API's barcode reader (Chrome on Android and desktop); absent from TypeScript's DOM types. */
  var BarcodeDetector: {
    new (options?: { formats?: string[] }): { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
  }
}

/** Whether this browser can scan a QR code in the app: a camera and the BarcodeDetector (Chrome on Android), in a
 *  secure context (https or localhost). Elsewhere the phone's camera app opens the QR code's link instead. */
export function canScanConnection(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'BarcodeDetector' in window &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}
