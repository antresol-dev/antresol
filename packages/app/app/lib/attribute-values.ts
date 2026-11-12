import { parseNumberValue, type Attribute } from '@antresol/core'

export type ParsedInput = { value: string } | { error: 'invalid_number' | 'invalid_option' | 'name_required' }

/** What a typed value of an attribute stores: a canonical number, an option as the list spells it (case does not matter),
 *  or trimmed text. Empty input is an error here; callers that allow "no value" check for it first. */
export function parseAttributeInput(a: Pick<Attribute, 'kind' | 'options' | 'unit' | 'siPrefixes'>, text: string): ParsedInput {
  const trimmed = text.trim()
  if (trimmed === '') return { error: 'name_required' }
  if (a.kind === 'number') {
    const value = parseNumberValue(trimmed, { unit: a.unit, siPrefixes: a.siPrefixes })
    return value === null ? { error: 'invalid_number' } : { value }
  }
  if (a.kind === 'enum') {
    const key = trimmed.toLowerCase()
    const option = a.options.find((o) => o.toLowerCase() === key)
    return option === undefined ? { error: 'invalid_option' } : { value: option }
  }
  return { value: trimmed }
}
