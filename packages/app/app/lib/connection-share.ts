import { checkConnectionString } from './sources'
import type { ConnectionSettings } from '@antresol/kit'
import type { PhotoStore, SourceConfig } from './types'

/**
 * Moving a source's settings to another device by QR code, paired by a code the RECEIVING device makes:
 *
 * 1. The phone (Settings → Receive a source) makes a random one-time code and keeps it for PAIRING_TTL_MS.
 * 2. The computer (Settings → Share) takes that code, encrypts the settings with it (PBKDF2 → AES-GCM) and shows a QR
 *    code with a link to the new-source page: `…/settings/sources/new#pair=<token>`.
 * 3. The phone scans it (in the app, or with the camera app, which opens the link) and decrypts it with the code it is
 *    waiting with; the code is then used up.
 *
 * So a QR code photographed by someone else is useless without the code, and a link nobody asked for (someone else's
 * database) is refused: no code is waiting for it. The fragment never reaches a server.
 */

/** What the new-source form takes from another device: no id, no creation time. */
export type SharedConnection = ConnectionSettings

export const PAIR_PARAM = 'pair'
export const PAIRING_TTL_MS = 10 * 60_000
/** Crockford's base32: no I, L, O, U. 8 characters = 40 bits. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const PAIRING_CODE_LENGTH = 8
/** Slow on purpose: someone holding a photo of the QR code has to try codes one by one at this cost. */
export const PBKDF2_ITERATIONS = 600_000
const TOKEN_VERSION = 2
const SALT_BYTES = 16
const IV_BYTES = 12
const AAD = new TextEncoder().encode('antresol-pair-v2')
const STORES: readonly PhotoStore[] = ['uploadcare', 'cloudinary', 'imgbb', 'imgur']
const OPTIONAL = [
  'uploadcarePublicKey',
  'uploadcareCdnBase',
  'cloudinaryCloudName',
  'cloudinaryUploadPreset',
  'imgurClientId',
  'imgbbApiKey',
] as const

// --- Codes -----------------------------------------------------------------------------------------------------------

/** A fresh random code, canonical form ("K7M2Q9XP"). */
export function newPairingCode(): string {
  // 256 is a multiple of 32: every character equally likely.
  return Array.from(crypto.getRandomValues(new Uint8Array(PAIRING_CODE_LENGTH)), (b) => ALPHABET[b % 32]).join('')
}

/** As shown: "K7M2-Q9XP". */
export function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

/** What a person typed → the canonical code, or null. Case, spaces and dashes don't matter; O reads as 0, I and L as 1. */
export function normalizePairingCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  return code.length === PAIRING_CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null
}

// --- The waiting code on the receiving device -------------------------------------------------------------------------

export interface PendingPairing {
  code: string
  expiresAt: number
}
type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const PENDING_KEY = 'antresol.pairing'

/** Storage may be missing or throw (private mode, blocked site data): no waiting code then. */
function safe<T>(f: () => T, fallback: T): T {
  try {
    return f()
  } catch {
    return fallback
  }
}

/** The code this device is waiting with, while it has not expired. */
export function pendingPairing(storage: KeyValue | null, now: number): PendingPairing | null {
  const raw = storage ? safe(() => storage.getItem(PENDING_KEY), null) : null
  if (!raw) return null
  const p = safe(() => JSON.parse(raw) as Partial<PendingPairing>, {})
  if (typeof p.code !== 'string' || typeof p.expiresAt !== 'number' || normalizePairingCode(p.code) !== p.code) return null
  return p.expiresAt > now ? { code: p.code, expiresAt: p.expiresAt } : null
}

/** Waits with a new code (replacing any other). */
export function startPairing(storage: KeyValue | null, now: number): PendingPairing {
  const p = { code: newPairingCode(), expiresAt: now + PAIRING_TTL_MS }
  if (storage) safe(() => storage.setItem(PENDING_KEY, JSON.stringify(p)), undefined)
  return p
}

export function endPairing(storage: KeyValue | null): void {
  if (storage) safe(() => storage.removeItem(PENDING_KEY), undefined)
}

// --- Sealing ---------------------------------------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function keyFrom(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** A source's connection settings: no id, no creation time; empty optional values are left out. */
export function connectionSettingsOf(source: SourceConfig | SharedConnection): SharedConnection {
  const out: SharedConnection = { name: source.name, connectionString: source.connectionString }
  if (source.photoStore) out.photoStore = source.photoStore
  for (const key of OPTIONAL) {
    const value = source[key]
    if (typeof value === 'string' && value !== '') out[key] = value
  }
  return out
}

/** The settings as JSON, to keep the QR code small. */
function payload(source: SourceConfig | SharedConnection): string {
  return JSON.stringify(connectionSettingsOf(source))
}

/** The decrypted JSON → the connection; null for anything the form would refuse. */
function parsePayload(json: string): SharedConnection | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.name !== 'string' || typeof d.connectionString !== 'string') return null
  if (checkConnectionString(d.connectionString) !== null) return null
  const out: SharedConnection = { name: d.name, connectionString: d.connectionString }
  if (typeof d.photoStore === 'string' && (STORES as readonly string[]).includes(d.photoStore)) out.photoStore = d.photoStore as PhotoStore
  for (const key of OPTIONAL) if (typeof d[key] === 'string') out[key] = d[key]
  return out
}

/** The settings encrypted with the receiving device's code: version · salt · iv · AES-GCM ciphertext, base64url. */
export async function sealConnection(source: SourceConfig | SharedConnection, code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await keyFrom(code, salt)
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, key, new TextEncoder().encode(payload(source))),
  )
  return toBase64Url(new Uint8Array([TOKEN_VERSION, ...salt, ...iv, ...sealed]))
}

/** The token opened with `code`; null for a wrong code, a changed token, another format or settings the form refuses. */
export async function openConnection(token: string, code: string): Promise<SharedConnection | null> {
  let bytes: Uint8Array
  try {
    bytes = fromBase64Url(token)
  } catch {
    return null
  }
  if (bytes.length <= 1 + SALT_BYTES + IV_BYTES || bytes[0] !== TOKEN_VERSION) return null
  const salt = bytes.slice(1, 1 + SALT_BYTES)
  const iv = bytes.slice(1 + SALT_BYTES, 1 + SALT_BYTES + IV_BYTES)
  try {
    const key = await keyFrom(code, salt)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: AAD },
      key,
      bytes.slice(1 + SALT_BYTES + IV_BYTES),
    )
    return parsePayload(new TextDecoder('utf-8', { fatal: true }).decode(plain))
  } catch {
    return null
  }
}

/** The address the QR code holds: this app's new-source page (under `base`, e.g. `https://host/antresol/`). */
export async function connectionLink(base: string, source: SourceConfig | SharedConnection, code: string): Promise<string> {
  return `${base.replace(/\/*$/, '/')}settings/sources/new#${PAIR_PARAM}=${await sealConnection(source, code)}`
}

/** The sealed token in a scanned text or a page fragment; null when there is none. */
export function pairToken(text: string): string | null {
  return new RegExp(`(?:^|[#&?])${PAIR_PARAM}=([A-Za-z0-9_-]+)`).exec(text.trim())?.[1] ?? null
}

// --- Scanning --------------------------------------------------------------------------------------------------------

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

/** Whether this browser can seal and open tokens: Web Crypto exists only in a secure context. */
export function canPair(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!globalThis.crypto?.subtle
}
