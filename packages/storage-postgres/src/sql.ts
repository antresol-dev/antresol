export interface Statement {
  text: string
  params: unknown[]
}

function isStatement(value: unknown): value is Statement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Statement).text === 'string' &&
    Array.isArray((value as Statement).params)
  )
}

/** Tagged template: values become $1..$n; a nested Statement is inlined with renumbered params. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): Statement {
  let text = strings[0] ?? ''
  const params: unknown[] = []
  values.forEach((value, i) => {
    if (isStatement(value)) {
      const offset = params.length
      text += value.text.replace(/\$(\d+)/g, (_, n: string) => `$${Number(n) + offset}`)
      params.push(...value.params)
    } else {
      params.push(value)
      text += `$${params.length}`
    }
    text += strings[i + 1] ?? ''
  })
  return { text, params }
}

/** `"col" = $n, ...` for the given columns; undefined values are skipped. */
export function updateSet(columns: Record<string, unknown>): Statement {
  const parts: string[] = []
  const params: unknown[] = []
  for (const [name, value] of Object.entries(columns)) {
    if (value === undefined) continue
    params.push(value)
    parts.push(`"${name.replace(/"/g, '""')}" = $${params.length}`)
  }
  return { text: parts.join(', '), params }
}
