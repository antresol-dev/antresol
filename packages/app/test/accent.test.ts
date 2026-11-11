import { describe, expect, it } from 'vitest'
import { ACCENTS, DEFAULT_ACCENT, applyAccent, createAccent, isAccentName, type AccentName } from '../app/lib/accent'
import { createMemoryDeviceDb } from '../app/lib/device-db'
import { contrast, mixHex } from './fixtures/color'

const names = Object.keys(ACCENTS) as AccentName[]
const LIGHT_BG = '#EDEFF3'
const DARK_BG = '#2A2E37'

/** A stand-in for <html>: only the inline style is touched. */
function fakeRoot(): { el: HTMLElement; props: Map<string, string> } {
  const props = new Map<string, string>()
  const el = { style: { setProperty: (k: string, v: string) => void props.set(k, v) } } as unknown as HTMLElement
  return { el, props }
}

describe('accent palette (spec 4.1)', () => {
  it('has the ten colours of the spec, indigo #4F46E5 by default', () => {
    expect(names).toEqual(['indigo', 'violet', 'blue', 'sky', 'teal', 'green', 'orange', 'rose', 'pink', 'slate'])
    expect(DEFAULT_ACCENT).toBe('indigo')
    expect(ACCENTS.indigo.light).toBe('#4F46E5')
    expect(ACCENTS.teal.light).toBe('#0F766E')
    expect(ACCENTS.slate.light).toBe('#475569')
  })

  it.each(names)('%s: white text on the painted accent is at least 4.5:1', (name) => {
    expect(contrast('#FFFFFF', ACCENTS[name].light)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(names)('%s: selected-row text mix(accent, black, 0.18) on its gradient over #EDEFF3 is at least 4.5:1', (name) => {
    const A = ACCENTS[name].light
    const ink = mixHex(A, '#000000', 0.18)
    // The gradient's strongest end (accent at 17 %) is the darkest backdrop.
    expect(contrast(ink, mixHex(LIGHT_BG, A, 0.17))).toBeGreaterThanOrEqual(4.5)
  })

  it.each(names)('%s: the dark-theme accent is the light one lifted by 12 % white (board 8)', (name) => {
    expect(ACCENTS[name].dark).toBe(mixHex(ACCENTS[name].light, '#FFFFFF', 0.12))
  })

  it.each(names)('%s: dark-theme accent text mix(accent, white, 0.5) on #2A2E37 is at least 4.5:1', (name) => {
    expect(contrast(mixHex(ACCENTS[name].light, '#FFFFFF', 0.5), DARK_BG)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('isAccentName', () => {
  it('accepts the palette names only', () => {
    expect(isAccentName('teal')).toBe(true)
    expect(isAccentName('neon')).toBe(false)
    expect(isAccentName('toString')).toBe(false)
    expect(isAccentName(undefined)).toBe(false)
    expect(isAccentName(3)).toBe(false)
  })
})

describe('applyAccent', () => {
  it('writes both theme variants on the root, which the CSS picks --accent from', () => {
    const { el, props } = fakeRoot()
    applyAccent('teal', el)
    expect(props.get('--accent-light')).toBe('#0F766E')
    expect(props.get('--accent-dark')).toBe(ACCENTS.teal.dark)
  })
})

describe('createAccent (device setting)', () => {
  it('load applies the stored accent', async () => {
    const db = createMemoryDeviceDb()
    await db.putSettings({ accent: 'rose' })
    const { el, props } = fakeRoot()
    const accent = createAccent(db, el)
    await accent.load()
    expect(accent.current.value).toBe('rose')
    expect(props.get('--accent-light')).toBe(ACCENTS.rose.light)
  })

  it('treats a missing or unknown value as not set, and keeps an unknown one stored', async () => {
    const db = createMemoryDeviceDb()
    const { el, props } = fakeRoot()
    const fresh = createAccent(db, el)
    await fresh.load()
    expect(fresh.current.value).toBe('indigo')
    expect(props.get('--accent-light')).toBe('#4F46E5')

    // A newer app's colour: this one does not know it, but must not erase it.
    await db.putSettings({ accent: 'neon' as AccentName })
    const later = createAccent(db, el)
    await later.load()
    expect(later.current.value).toBe('indigo')
    expect((await db.getSettings()).accent).toBe('neon')
  })

  it('set applies at once and saves on the device', async () => {
    const db = createMemoryDeviceDb()
    const { el, props } = fakeRoot()
    const accent = createAccent(db, el)
    await accent.set('green')
    expect(accent.current.value).toBe('green')
    expect(props.get('--accent-light')).toBe(ACCENTS.green.light)
    expect((await db.getSettings()).accent).toBe('green')
  })

  it('load survives a failing device store and keeps the default', async () => {
    const db = createMemoryDeviceDb()
    db.getSettings = () => Promise.reject(new Error('blocked'))
    const { el, props } = fakeRoot()
    const accent = createAccent(db, el)
    await expect(accent.load()).resolves.toBeUndefined()
    expect(accent.current.value).toBe('indigo')
    expect(props.get('--accent-light')).toBe('#4F46E5')
  })
})
