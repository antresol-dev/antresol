import en from '../../app/i18n/locales/en.json'

/**
 * The app's English text for a message key ("intakes.line.needsValue"), `{name}` filled from `params`. The app's
 * plural forms ("one | many") give their first form. An unknown key is returned as it is.
 */
export function messageFor(key: string, params: Record<string, string> = {}): string {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return key
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node !== 'string') return key
  const first = node.split('|')[0]!.trim()
  return first.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole)
}
