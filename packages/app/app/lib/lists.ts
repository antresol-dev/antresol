import type { AttributeKind } from '@antresol/core'

/** Splits on commas, semicolons and line breaks; trims; drops empty; removes case-insensitive duplicates, keeping the first. */
export function parseNameList(text: string): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const part of text.split(/[,;\r\n]+/)) {
    const name = part.trim()
    const key = name.toLowerCase()
    if (name === '' || seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names
}

/** Values typed or pasted as a list: line breaks, `;` and `,` separate them; for numbers a comma between two digits is a
 *  decimal comma (`4,7k`). Trimmed, empty parts dropped; repeats are kept (the commands reject them). */
export function splitValueList(input: string, kind: AttributeKind): string[] {
  const separators = kind === 'number' ? /\r?\n|;|(?<!\d),|,(?!\d)/ : /\r?\n|;|,/
  return input
    .split(separators)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/** One variant per line, its values separated by `;` in axis order. Empty lines and trailing empty parts are dropped. */
export function splitVariantLines(input: string): string[][] {
  const rows: string[][] = []
  for (const line of input.split(/\r?\n/)) {
    const parts = line.split(';').map((part) => part.trim())
    while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
    if (parts.length > 0) rows.push(parts)
  }
  return rows
}
