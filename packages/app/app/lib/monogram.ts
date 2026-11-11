const KEPT = /[\p{L}\p{N}]/u
const DIGIT = /\p{N}/u
const LETTER = /\p{L}/u

/** Two characters that stand for an item without a photo (spec 4.11):
 *  - a part number (a first word with a digit): its first two characters, "TL072 op-amp" → "TL", "1N4148" → "1N";
 *  - two words, the second starting with a letter: their first letters, "Heat shrink tubing" → "HS";
 *  - otherwise the first two letters of the first word, "Резистор 0,25 Вт" → "Ре".
 *  Words are read without punctuation and symbols; '' when nothing is left. */
export function monogram(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => [...w].filter((ch) => KEPT.test(ch)))
    .filter((chars) => chars.length > 0)
  const [first, second] = words
  if (!first) return ''
  if (first.some((ch) => DIGIT.test(ch))) return first.slice(0, 2).join('').toUpperCase()
  if (second && LETTER.test(second[0]!)) return `${first[0]!}${second[0]!}`.toUpperCase()
  return `${first[0]!.toUpperCase()}${first[1] ?? ''}`
}
