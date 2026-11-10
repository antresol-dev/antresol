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
