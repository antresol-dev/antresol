import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// The design-system scales (plan 12) as a test: markup may use only the text sizes, weights, spacing steps and
// durations of the scales, so a stray `text-[13px]` or `p-2.5` fails here instead of surviving a review.
// Text sizes: text-xs/sm/base/lg/2xl/4xl (values set in @theme). Spacing: the 4 px grid (Tailwind steps), plus 0.5 and
// 1.5 inside small controls. Durations: tokens from main.css (`duration-(--dur-fast)`), never `duration-150`.

const appDir = new URL('../app', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:vue|ts)$/.test(path) ? [path] : []
  })
}

// Class strings split at quotes, whitespace, braces and the like. Inside square brackets only `=` and `>` are kept
// (`data-[state=open]:x`, `has-[>svg]:x`, `[&>svg]:x` stay one token); quotes and whitespace still end a token, so a
// JS array in a script cannot swallow what follows it.
export function tokenize(src: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let cur = ''
  for (const c of src) {
    if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    if (depth === 0 ? /[\s"'`<>={},;]/.test(c) : /[\s"'`<{},;]/.test(c)) {
      if (/[\s"'`<{},;]/.test(c)) depth = 0
      if (cur) tokens.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur) tokens.push(cur)
  return tokens
}

// Comments may mention the banned classes ("was text-[13px]"); only live markup and script count.
const stripComments = (src: string) => src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, ' ')

// Variant prefixes (`md:`, `hover:`, `data-[state=open]:`) end at the last colon outside brackets.
function stripVariants(token: string): string {
  let depth = 0
  let cut = -1
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[' || c === '(') depth++
    else if (c === ']' || c === ')') depth--
    else if (c === ':' && depth === 0) cut = i
  }
  return token.slice(cut + 1)
}

const SPACING = '(?:p|px|py|pt|pb|pl|pr|ps|pe|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|left|right|bottom|start|end)'
const SIZING = '(?:size|h|min-h|max-h|w|min-w|max-w|rounded|text)'
const BAD_HALF_STEP = new RegExp(`^-?${SPACING}-(?:2\\.5|3\\.5|4\\.5)$`)
const ARBITRARY_PX = new RegExp(`^-?(?:${SPACING}|${SIZING})-\\[(.+)\\]$`)
const BAD_TEXT = /^text-(?:\[.+\]|xl|3xl|[5-9]xl)$/
const BAD_WEIGHT = /^font-(?:bold|extrabold)$/
const BAD_DURATION = /^duration-\d+$/

// A raw px term outside env()/var(): safe-area calcs and token reads are fine, a literal 7px is not.
const hasRawPx = (value: string) => /\d(?:\.\d+)?px/.test(value.replace(/(?:env|var)\([^)]*\)/g, ''))

function violation(raw: string): string | null {
  const token = stripVariants(raw).replace(/^!/, '')
  if (BAD_TEXT.test(token)) return 'off-scale text size'
  if (BAD_WEIGHT.test(token)) return 'bold weight (use font-semibold)'
  if (BAD_HALF_STEP.test(token)) return 'off-grid spacing step'
  if (BAD_DURATION.test(token)) return 'raw duration (use duration-(--dur-*))'
  const arbitrary = ARBITRARY_PX.exec(token)
  if (arbitrary && hasRawPx(arbitrary[1]!)) return 'arbitrary px value'
  return null
}

type Hit = { file: string; class: string; why: string }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const path of sourceFiles(appDir)) {
    const file = relative(appDir, path)
    const seen = new Set<string>()
    for (const raw of tokenize(stripComments(readFileSync(path, 'utf8')))) {
      if (!raw || seen.has(raw)) continue
      seen.add(raw)
      const why = violation(raw)
      if (why) hits.push({ file, class: raw, why })
    }
  }
  return hits
}

// Allowed exceptions: each names the file, the exact class and the reason. A listed class that no longer occurs fails
// the test, so the list cannot go stale.
const EXCEPTIONS: Hit[] = [
  { file: 'components/AppSheet.vue', class: 'md:max-w-[480px]', why: 'Layout width: the sheet is a 480 px column on tablet and desktop.' },
  { file: 'components/IntervalSlider.vue', class: 'top-[calc(50%+7px)]', why: 'Slider geometry: tick marks sit 7 px below the track centre, tied to the thumb size.' },
  { file: 'components/MobileDock.vue', class: 'max-w-[720px]', why: 'Layout width: the dock follows the content column of ScreenBody.' },
  { file: 'components/NavDrawer.vue', class: 'max-w-[340px]', why: 'Layout width: the drawer is at most 340 px on wide phones.' },
  { file: 'components/ScreenBody.vue', class: 'max-w-[720px]', why: 'Layout width: content column on tablet.' },
  { file: 'components/ScreenBody.vue', class: 'lg:max-w-[760px]', why: 'Layout width: content column on desktop.' },
  { file: 'components/ScreenHeader.vue', class: 'max-w-[720px]', why: 'Layout width: header column matches ScreenBody.' },
  { file: 'components/ScreenHeader.vue', class: 'lg:max-w-[760px]', why: 'Layout width: header column matches ScreenBody.' },
  { file: 'components/SearchPalette.vue', class: 'top-[72px]', why: 'Layout offset: the palette hangs 72 px below the viewport top.' },
  { file: 'components/SearchPalette.vue', class: 'max-h-[calc(100dvh-144px)]', why: 'Layout height: the palette keeps 72 px above and below within the viewport.' },
  { file: 'components/SearchPalette.vue', class: 'w-[580px]', why: 'Layout width: the palette on desktop.' },
  { file: 'components/SearchPalette.vue', class: 'max-h-[380px]', why: 'Layout height: the result list scrolls inside the palette.' },
  { file: 'components/ui/combobox/ComboboxAnchor.vue', class: 'w-[200px]', why: 'Layout width: default combobox width, the same as its list.' },
  { file: 'components/ui/combobox/ComboboxList.vue', class: 'w-[200px]', why: 'Layout width: default combobox list width, the same as its anchor.' },
  { file: 'components/ui/combobox/ComboboxViewport.vue', class: 'max-h-[300px]', why: 'Layout height: the option list scrolls inside the popover.' },
]

const key = (h: { file: string; class: string }) => `${h.file} :: ${h.class}`

describe('the guard itself', () => {
  it('keeps bracketed variants in one token and flags their off-scale classes', () => {
    const src = `<div class="data-[state=open]:text-[13px] has-[>svg]:px-2.5 [&>svg]:p-2.5 aria-[x=y]:duration-150 md:px-4" />`
    const bad = tokenize(src).filter((t) => violation(t))
    expect(bad).toEqual(['data-[state=open]:text-[13px]', 'has-[>svg]:px-2.5', '[&>svg]:p-2.5', 'aria-[x=y]:duration-150'])
  })

  it('accepts on-scale bracketed variants', () => {
    expect(tokenize(`"data-[state=open]:text-sm has-[>svg]:px-2 [&>svg]:size-4"`).filter((t) => violation(t))).toEqual([])
  })
})

describe('design scales in markup', () => {
  const hits = scan()
  const allowed = new Set(EXCEPTIONS.map(key))

  it('has no off-scale text, weight, spacing or duration classes', () => {
    const bad = hits.filter((h) => !allowed.has(key(h)))
    expect(bad.map((h) => `${key(h)}  (${h.why})`), 'off-scale classes (fix, or add to EXCEPTIONS with a reason)').toEqual([])
  })

  it('lists only exceptions that still occur', () => {
    const present = new Set(hits.map(key))
    const stale = EXCEPTIONS.filter((e) => !present.has(key(e))).map(key)
    expect(stale, 'stale exceptions (remove them)').toEqual([])
  })

  it('gives every exception a reason', () => {
    expect(EXCEPTIONS.filter((e) => e.why.trim().length < 10).map(key)).toEqual([])
  })
})
