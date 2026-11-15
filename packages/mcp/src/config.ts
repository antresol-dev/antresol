import path from 'node:path'
import { decodeConnectionKey, type ConnectionSettings } from '@antresol/kit'

export interface ServerConfig {
  /** The connection from ANTRESOL_CONNECTION; null when it is missing or does not decode (see `connectionProblem`). */
  connection: ConnectionSettings | null
  connectionProblem: 'missing' | 'invalid' | null
  /** The raw ANTRESOL_CONNECTION text (trimmed), kept only so it can be scrubbed from outputs. */
  connectionKey: string | null
  /** Where photos to upload are looked for (ANTRESOL_PHOTOS_DIR, else the system pictures folder + Antresol). */
  photosDir: string
  /** The server's own files, `<home>/.antresol`. */
  stateDir: string
}

const joinFor = (platform: NodeJS.Platform) => (platform === 'win32' ? path.win32.join : path.join)

/** An empty value, or a `${...}` placeholder a host left unexpanded (Claude Desktop does for an optional setting the person never set), is unset. */
const filled = (text: string | undefined): string | null => {
  const t = text?.trim()
  return t === undefined || t === '' || /^\$\{[^}]+\}$/.test(t) ? null : t
}

/** The pictures folder of the system plus `Antresol`: `~/Pictures/Antresol` on macOS, `%USERPROFILE%\Pictures\Antresol`
 *  on Windows, `$XDG_PICTURES_DIR/Antresol` (else `~/Pictures/Antresol`) elsewhere. */
export function defaultPhotosDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  const join = joinFor(platform)
  if (platform !== 'darwin' && platform !== 'win32') {
    const xdg = filled(env.XDG_PICTURES_DIR)
    if (xdg) return join(xdg, 'Antresol')
  }
  return join(home, 'Pictures', 'Antresol')
}

/** An empty ANTRESOL_PHOTOS_DIR, or an unexpanded `${...}` placeholder, counts as unset (same for the key). Never throws: a bad key is `connectionProblem: 'invalid'`. */
export function readConfig(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): ServerConfig {
  let connection: ConnectionSettings | null = null
  let connectionProblem: ServerConfig['connectionProblem'] = null
  const key = filled(env.ANTRESOL_CONNECTION)
  if (key === null) connectionProblem = 'missing'
  else {
    try {
      connection = decodeConnectionKey(key)
    } catch {
      connectionProblem = 'invalid'
    }
  }
  return {
    connection,
    connectionProblem,
    connectionKey: key,
    photosDir: filled(env.ANTRESOL_PHOTOS_DIR) ?? defaultPhotosDir(platform, env, home),
    stateDir: joinFor(platform)(home, '.antresol'),
  }
}
