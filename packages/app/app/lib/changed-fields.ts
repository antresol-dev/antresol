type Field = string | number | boolean | null | undefined | readonly string[]

function same(a: Field, b: Field): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    // Id lists are sets: the order does not matter.
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    const left = new Set(a as readonly string[])
    const right = new Set(b as readonly string[])
    return left.size === right.size && [...left].every((x) => right.has(x))
  }
  // Text is compared the way the forms normalize it: trimmed, and '' is the same as no value.
  const norm = (v: Field) => (typeof v === 'string' ? v.trim() || null : (v ?? null))
  return norm(a) === norm(b)
}

/**
 * The fields of `after` whose value differs from `before`, so an edit form sends only what the person changed and a
 * stale form cannot overwrite an edit made elsewhere. Arrays are sent whole, and only when the set changed. Values are
 * returned as given in `after` (the form passes them already normalized).
 */
export function changedFields<T extends Record<string, Field>>(before: T, after: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (!same(before[key], after[key])) out[key] = after[key]
  }
  return out
}
