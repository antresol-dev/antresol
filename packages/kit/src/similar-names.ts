import { sameName, type Id } from '@antresol/core'

/** Names that look alike (spec 2026-11-17 §5): advice, never a refusal. The rules, in this order:
 *  - `same`: equal (trim, no case); the caller passes only candidates that are not hard duplicates (items of other
 *    folders), so an equal name is reported, not dropped;
 *  - `spacing`: equal once spaces, `-`, `.` and `_` are removed (no case);
 *  - `plural`: equal after folding a final `s` / `es`;
 *  - `typo`: edit distance at most 2 when both are 6+ letters long, at most 1 when shorter;
 *  - `contains`: one holds the other as whole words ("SMD Resistor" holds "Resistor").
 */
export type SimilarWhy = 'same' | 'spacing' | 'plural' | 'typo' | 'contains'
export interface SimilarName {
  id: Id
  name: string
  /** Where it lives (a folder path), when the caller says; passed through. */
  where?: string
  why: SimilarWhy
}

const ORDER: SimilarWhy[] = ['same', 'spacing', 'plural', 'typo', 'contains']
const compact = (t: string): string => t.toLowerCase().replace(/[\s\-._]+/gu, '')
const words = (t: string): string[] => t.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '')

function distance(a: string, b: string, limit: number): number {
  const x = [...a]
  const y = [...b]
  if (Math.abs(x.length - y.length) > limit) return limit + 1
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1))
    }
    prev = row
  }
  return prev[y.length]!
}

const pluralOf = (a: string, b: string): boolean =>
  a !== b && (a === `${b}s` || a === `${b}es` || b === `${a}s` || b === `${a}es`)

/** Whole words of `small` in a row inside `big`. */
function holds(big: string[], small: string[]): boolean {
  if (small.length === 0 || small.length >= big.length) return false
  for (let i = 0; i + small.length <= big.length; i++) if (small.every((w, k) => big[i + k] === w)) return true
  return false
}

function whyAlike(a: string, b: string): SimilarWhy | null {
  if (sameName(a, b)) return 'same'
  const x = compact(a)
  const y = compact(b)
  if (x === '' || y === '') return null
  if (x === y) return 'spacing'
  if (pluralOf(x, y)) return 'plural'
  if (distance(x, y, 2) <= (Math.min([...x].length, [...y].length) >= 6 ? 2 : 1)) return 'typo'
  const wa = words(a)
  const wb = words(b)
  if (holds(wa, wb) || holds(wb, wa)) return 'contains'
  return null
}

/** The candidates whose names look like `name`, most alike first (rule order, then as given). */
export function similarNames(candidates: readonly { id: Id; name: string; where?: string }[], name: string): SimilarName[] {
  if (name.trim() === '') return []
  const out: SimilarName[] = []
  for (const c of candidates) {
    const why = whyAlike(name, c.name)
    if (why) out.push({ id: c.id, name: c.name, ...(c.where !== undefined ? { where: c.where } : {}), why })
  }
  return out.sort((a, b) => ORDER.indexOf(a.why) - ORDER.indexOf(b.why))
}
