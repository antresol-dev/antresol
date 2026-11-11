import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'
import css from '../app/assets/css/main.css?raw'
import { ACCENTS, type AccentName } from '../app/lib/accent'
import { contrast, cssVars, parseColor, resolveColor, type Vars } from './fixtures/color'

/*
 * The "Hybrid v2" tokens and utilities in main.css (spec 2026-11-11 §4.1, §4.2; Review Focus 4): every text/background
 * pair of both themes at 4.5:1 or better for every accent, the mock-up's shadow numbers, the pointer cursor rule.
 */

const accents = Object.keys(ACCENTS) as AccentName[]
const root = cssVars(css, ':root')
const dark = cssVars(css, '.dark')
const painted = cssVars(css, '.painted')
const paintedDestructive = cssVars(css, '.painted-destructive')

function themeVars(theme: 'light' | 'dark', accent: AccentName): Vars {
  return theme === 'light'
    ? { ...root, 'accent-light': ACCENTS[accent].light }
    : { ...root, ...dark, 'accent-dark': ACCENTS[accent].dark }
}

/** Text token on background token. A translucent background is drawn over --background. */
const pairs: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['foreground', 'hover'],
  ['foreground', 'pressed'],
  ['foreground', 'chip'],
  ['foreground', 'thumb'],
  ['foreground', 'field'],
  ['foreground', 'rail'],
  ['foreground', 'popover'],
  ['foreground', 'accent-soft'],
  ['foreground', 'ghost-pressed'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'hover'],
  ['muted-foreground', 'pressed'],
  ['muted-foreground', 'chip'],
  ['muted-foreground', 'thumb'],
  ['muted-foreground', 'field'],
  ['muted-foreground', 'rail'],
  ['subtle-foreground', 'background'],
  ['subtle-foreground', 'hover'],
  ['subtle-foreground', 'chip'],
  ['dimmed-foreground', 'background'],
  ['dimmed-foreground', 'hover'],
  ['thumb-foreground', 'thumb'],
  ['icon', 'background'],
  ['icon', 'hover'],
  ['icon', 'rail'],
  // Accent-coloured text: the selected row (strongest end of its gradient), links, the soft accent chip.
  ['accent-ink', 'background'],
  ['accent-ink', 'hover'],
  ['accent-ink', 'pressed'],
  ['accent-ink', 'selected-from'],
  ['accent-ink', 'accent-soft'],
  ['accent-soft-foreground', 'accent-soft'],
  ['selected-muted', 'selected-from'],
  // The painted accent button and its fills.
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'hover'],
  ['destructive-foreground', 'destructive'],
  ['warning', 'background'],
  // Tooltip: inverted.
  ['background', 'foreground'],
]

describe.each(['light', 'dark'] as const)('%s theme contrast', (theme) => {
  describe.each(accents)('accent %s', (accent) => {
    const vars = themeVars(theme, accent)
    const base = resolveColor('background', vars)
    it.each(pairs)('%s on %s is at least 4.5:1', (fg, bg) => {
      expect(contrast(resolveColor(fg, vars), resolveColor(bg, vars), base)).toBeGreaterThanOrEqual(4.5)
    })
    it.each([
      ['accent', painted],
      ['destructive', { ...painted, ...paintedDestructive }],
    ] as const)('painted %s button: text on rest, hover and pressed is at least 4.5:1', (_, block) => {
      const local = { ...vars, ...block }
      const fg = resolveColor('paint-foreground', local)
      for (const bg of ['paint', 'paint-hover', 'paint-pressed']) {
        expect(contrast(fg, resolveColor(bg, local), base), bg).toBeGreaterThanOrEqual(4.5)
      }
    })
  })
})

describe('spec values', () => {
  const hex = (name: string, vars: Vars) => resolveColor(name, vars)
  it('light theme', () => {
    const v = themeVars('light', 'indigo')
    expect(hex('background', v)).toEqual(parseColor('#EDEFF3'))
    expect(hex('surface', v)).toEqual(parseColor('#EDEFF3'))
    expect(hex('foreground', v)).toEqual(parseColor('#1C2030'))
    expect(hex('muted-foreground', v)).toEqual(parseColor('#565D6E'))
    expect(hex('icon', v)).toEqual(parseColor('#2F3442'))
    expect(hex('divider', v)).toEqual(parseColor('#D9DDE5'))
    expect(hex('chip', v)).toEqual(parseColor('#DDE1E8'))
    expect(hex('thumb', v)).toEqual(parseColor('#E2E5EB'))
    expect(hex('accent', v)).toEqual(parseColor('#4F46E5'))
    expect(hex('primary', v)).toEqual(parseColor('#4F46E5'))
    expect(hex('shadow-dark', v)).toEqual(parseColor('rgba(150, 160, 180, 0.29)'))
    expect(hex('shadow-light', v)).toEqual(parseColor('rgba(255, 255, 255, 0.96)'))
  })
  it('dark theme', () => {
    const v = themeVars('dark', 'indigo')
    expect(hex('background', v)).toEqual(parseColor('#24272E'))
    expect(hex('foreground', v)).toEqual(parseColor('#E7E9EE'))
    expect(hex('muted-foreground', v)).toEqual(parseColor('#A0A6B3'))
    expect(hex('icon', v)).toEqual(parseColor('#D4D8E0'))
    expect(hex('divider', v)).toEqual(parseColor('rgba(255, 255, 255, 0.06)'))
    expect(hex('shadow-dark', v)).toEqual(parseColor('rgba(0, 0, 0, 0.55)'))
    expect(hex('shadow-light', v)).toEqual(parseColor('rgba(255, 255, 255, 0.06)'))
    expect(hex('accent', v)).toEqual(parseColor(ACCENTS.indigo.dark))
  })
  it('the accent follows the root variables lib/accent.ts writes', () => {
    expect(resolveColor('accent', themeVars('light', 'teal'))).toEqual(parseColor('#0F766E'))
    expect(resolveColor('accent', themeVars('dark', 'teal'))).toEqual(parseColor(ACCENTS.teal.dark))
  })
})

describe('shadows: the mock-up hybrid2 sh() at depth 0.9, light 1.2, shade 0.7', () => {
  const depth = 0.9
  const light = 1.2
  const shade = 0.7
  const n = (v: number) => Math.round(v * depth * 10) / 10
  /** "dark-x dark-x dark-blur" and "−light-x −light-x light-blur" of sh(x, b). */
  function sh(x: number, b: number): [string, string] {
    const xd = n(x * (0.55 + 0.45 * shade))
    const bd = n(b * (0.6 + 0.4 * shade))
    const xl = n(x * light)
    const bl = n(b * light)
    return [`${xd}px ${xd}px ${bd}px`, `${-xl}px ${-xl}px ${bl}px`]
  }
  const raisedTokens: [string, number, number, string][] = [
    ['raised-shadow', 4, 10, 'shadow-dark'],
    ['raised-shadow-hover', 4, 10, 'shadow-hover'],
    ['raised-sm-shadow', 3, 7, 'shadow-dark'],
    ['raised-sm-shadow-hover', 3, 7, 'shadow-hover'],
    ['pill-shadow', 3, 8, 'shadow-dark'],
    ['pill-shadow-selected', 3, 8, 'shadow-selected'],
    ['card-shadow', 6, 14, 'shadow-dark'],
  ]
  it.each(raisedTokens)('--%s is R(%d, %d)', (token, x, b, darkColour) => {
    const [d, l] = sh(x, b)
    expect(root[token]).toMatch(new RegExp(`^${d} var\\(--${darkColour}\\), ${l} var\\(--shadow-light\\)`))
  })
  const pressedTokens: [string, number, number][] = [
    ['raised-shadow-pressed', 3, 7],
    ['raised-sm-shadow-pressed', 2.5, 6],
    ['step-shadow-pressed', 2, 5],
  ]
  it.each(pressedTokens)('--%s is I(%d, %d) after a zero outer pair', (token, x, b) => {
    const [d, l] = sh(x, b)
    expect(root[token]).toMatch(/^0px 0px 0px transparent, 0px 0px 0px transparent, inset /)
    expect(root[token]).toContain(`inset ${d} var(--shadow-pressed), inset ${l} var(--shadow-light)`)
  })
  it('raised and pressed lists have the same shape, so the change animates', () => {
    const shape = (v: string) => v.split(/,(?![^(]*\))/).map((p) => p.trim().startsWith('inset'))
    for (const [rest, pressed] of [
      ['raised-shadow', 'raised-shadow-pressed'],
      ['raised-shadow-hover', 'raised-shadow-pressed'],
      ['raised-sm-shadow', 'raised-sm-shadow-pressed'],
      ['flat-shadow', 'step-shadow-pressed'],
    ]) {
      expect(shape(root[rest]!), rest).toEqual(shape(root[pressed]!))
    }
  })
  it('light-theme shadow colours: dark 0.42·shade, light 0.8·light', () => {
    expect(root['shadow-dark']).toBe('rgba(150, 160, 180, 0.29)')
    expect(root['shadow-light']).toBe('rgba(255, 255, 255, 0.96)')
  })
})

describe('base styles and utilities', () => {
  /** The body of `@layer <name> { … }`. */
  function layer(name: string): string {
    const start = css.indexOf(`@layer ${name} {`)
    expect(start, `@layer ${name}`).toBeGreaterThanOrEqual(0)
    let depth = 0
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', start) + 1, i)
    }
    throw new Error('unbalanced')
  }
  const rules = (body: string) =>
    [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/['"\s]/g, ''),
      body: m[2]!,
    }))

  it('a pointer cursor for everything clickable (spec 4.2)', () => {
    const rule = rules(layer('base')).find((r) => /cursor:\s*pointer/.test(r.body))
    expect(rule).toBeDefined()
    for (const s of ['button:not(:disabled)', '[role=button]', 'a[href]', 'summary']) expect(rule!.selectors).toContain(s)
  })

  it('the default cursor for disabled elements', () => {
    const rule = rules(layer('base')).find((r) => /cursor:\s*default/.test(r.body))
    expect(rule?.selectors).toContain(':disabled')
  })

  it('a visible accent focus ring: 2 px, offset 2 px', () => {
    const rule = rules(layer('base')).find((r) => r.selectors === ':focus-visible')
    expect(rule?.body).toMatch(/outline:\s*2px solid var\(--ring\)/)
    expect(rule?.body).toMatch(/outline-offset:\s*2px/)
  })

  const utilities = ['raised', 'raised-sm', 'raised-card', 'painted', 'pressable', 'pill', 'pill-step', 'row-selected']
  it.each(utilities)('.%s is defined and listed in the header comment', (name) => {
    expect(rules(layer('components')).some((r) => r.selectors.split(',').includes(`.${name}`))).toBe(true)
    const header = css.match(/^[\s\S]*?\/\*([\s\S]*?)\*\//)?.[1] ?? ''
    expect(header).toMatch(new RegExp(`\\b${name}\\b`))
  })

  it('reduced motion: no scale and no shadow animation', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{[^@]*transform: scale\(var\(--active-scale\)\)/)
  })

  it('radius scale: 20 / 14 / 10', () => {
    expect(css).toMatch(/--radius-card:\s*20px/)
    expect(css).toMatch(/--radius-field:\s*14px/)
    expect(css).toMatch(/--radius-chip:\s*10px/)
  })
})

/*
 * Every component and page (spec 4.2, acceptance 3): whatever has a click handler is something the pointer rule in
 * main.css covers, so it shows cursor: pointer. The design-system controls keep their shadow, animation and focus
 * outline, and every radius is on the 20 / 14 / 10 / circle scale.
 */
describe('components and pages', () => {
  const appDir = fileURLToPath(new URL('../app', import.meta.url))
  function* vueFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) yield* vueFiles(path)
      else if (name.endsWith('.vue')) yield path
    }
  }
  const files = [...['components', 'pages', 'layouts'].flatMap((d) => [...vueFiles(join(appDir, d))]), join(appDir, 'app.vue')].map(
    (path) => {
      const source = readFileSync(path, 'utf8')
      return { name: relative(appDir, path), source, ast: parse(source).descriptor.template?.ast }
    },
  )
  // The copied shadcn-vue primitives are styled by Task 1 in their own terms (cn() merging, data-state variants).
  // Comments are blanked out (line numbers kept) for the text checks: prose may say "rounded".
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ')
  const appFiles = files
    .filter((f) => !f.name.startsWith('components/ui/'))
    .map((f) => ({ ...f, code: f.source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, blank) }))

  /** Template nodes as far as the checks need them (@vue/compiler-core: 1 element, 6 attribute, 7 directive). */
  interface Prop {
    type: number
    name: string
    value?: { content: string }
    arg?: { content: string }
    exp?: { content: string }
  }
  interface Node {
    type: number
    tag: string
    props: Prop[]
    children?: Node[]
    loc: { start: { line: number } }
  }
  function* elements(node: Node | undefined): Generator<Node> {
    if (!node) return
    if (node.type === 1) yield node
    for (const child of node.children ?? []) yield* elements(child)
  }
  const attr = (n: Node, name: string): string | undefined => n.props.find((p) => p.type === 6 && p.name === name)?.value?.content
  const has = (n: Node, name: string): boolean =>
    n.props.some((p) => (p.type === 6 && p.name === name) || (p.type === 7 && p.name === 'bind' && p.arg?.content === name))
  const onClick = (n: Node): boolean => n.props.some((p) => p.type === 7 && p.name === 'on' && p.arg?.content === 'click')
  /** Static class plus the :class expression text. */
  const classText = (n: Node): string =>
    n.props
      .filter((p) => (p.type === 6 && p.name === 'class') || (p.type === 7 && p.name === 'bind' && p.arg?.content === 'class'))
      .map((p) => p.value?.content ?? p.exp?.content ?? '')
      .join(' ')

  // What the base pointer rule covers: tags, `a[href]`, `label[for]` and roles.
  const pointerRule = css.match(/:where\(([^{]*)\)\s*\{\s*cursor:\s*pointer/)?.[1] ?? ''
  const pointerRoles = new Set([...pointerRule.matchAll(/\[role=['"]?([a-z]+)/g)].map((m) => m[1]!))
  // Components that render one of those: Button → <button>, links → a[href], menu items → role="menuitem…".
  const pointerComponents = new Set([
    'Button',
    'NuxtLink',
    'RouterLink',
    'DropdownMenuItem',
    'DropdownMenuCheckboxItem',
    'DropdownMenuRadioItem',
    'SelectItem',
    'ComboboxItem',
  ])

  /** Why a clickable element would show no pointer, or null when the pointer rule covers it. */
  function pointerProblem(n: Node, tag: string, template: Node): string | null {
    if (/(^|[\s'"`])cursor-(default|auto|text|none)\b/.test(classText(n))) return 'a cursor-* utility overrides the pointer'
    if (pointerComponents.has(tag)) return tag === 'Button' && attr(n, 'as') && attr(n, 'as') !== 'button' ? `Button as="${attr(n, 'as')}"` : null
    // createReusableTemplate: <ReuseX> renders the first element inside <DefineX>; attributes and @click fall through.
    const reused = /^Reuse(\w+)$/.exec(tag)
    if (reused) {
      const define = [...elements(template)].find((e) => e.tag === `Define${reused[1]}`)
      const inner = define?.children?.find((c) => c.type === 1)
      return inner ? pointerProblem({ ...inner, props: [...inner.props, ...n.props] }, inner.tag, template) : `<${tag}> without <Define${reused[1]}>`
    }
    if (tag === 'button' || tag === 'summary' || tag === 'select') return null
    if (tag === 'a') return has(n, 'href') ? null : '<a> without href'
    if (tag === 'label') return has(n, 'for') ? null : '<label> without for'
    const role = attr(n, 'role')
    if (!role || !pointerRoles.has(role)) return `<${tag}> without a pointer role`
    if (role === 'button' && !has(n, 'tabindex')) return 'role="button" without tabindex'
    return null
  }

  it('the pointer rule lists roles', () => {
    expect([...pointerRoles]).toEqual(expect.arrayContaining(['button', 'menuitem', 'option']))
  })

  it('every clickable element shows the pointer (spec 4.2)', () => {
    const problems: string[] = []
    for (const f of files) {
      for (const n of elements(f.ast as Node | undefined)) {
        if (!onClick(n)) continue
        // <component :is="a ? X : 'y'">: every tag it can become.
        const is = n.tag === 'component' ? n.props.find((p) => p.type === 7 && p.arg?.content === 'is')?.exp?.content ?? '' : null
        const tags = is === null ? [n.tag] : [...is.matchAll(/'([\w-]+)'|\b([A-Z]\w*)\b/g)].map((m) => m[1] ?? m[2]!)
        for (const tag of tags) {
          const problem = pointerProblem(n, tag, f.ast as Node)
          if (problem) problems.push(`${f.name}:${n.loc.start.line} ${problem}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('design-system controls keep their shadow, animation and focus outline', () => {
    // Raised and painted controls (a Button other than ghost and link is one): focus rings (box-shadow) replace their
    // shadow, outline-none removes the base focus outline, transitions replace their own, hover:bg-* is dead (the
    // states win). Flat pressable controls (ghost): no transitions or hover:bg-* either; an inset ring in a scroll box
    // is fine.
    const raisedClass = /(^|[\s'"`])(raised|raised-sm|painted|pill-step)($|[\s'"`])/
    const pressableClass = /(^|[\s'"`])pressable($|[\s'"`])/
    const raisedClash = /(^|[\s'"`])(focus-visible:ring[\w-]*|transition(-[\w[\],-]+)?|outline-none|hover:bg-[\w-/]+)($|[\s'"`])/
    const flatClash = /(^|[\s'"`])(transition(-[\w[\],-]+)?|hover:bg-[\w-/]+)($|[\s'"`])/
    const problems: string[] = []
    for (const f of appFiles) {
      // String constants in the script, by name, so a :class that names one is checked too.
      const consts = new Map(
        [...f.code.matchAll(/const (\w+)\s*=\s*\n?\s*(['`])([^'`]*)\2/g)].map((m) => [m[1]!, m[3]!]),
      )
      for (const n of elements(f.ast as Node | undefined)) {
        let text = classText(n)
        for (const [name, value] of consts) if (new RegExp(`\\b${name}\\b`).test(text)) text += ` ${value}`
        const variant = attr(n, 'variant') ?? (has(n, 'variant') ? 'dynamic' : 'default')
        const button = n.tag === 'Button' && variant !== 'link'
        const raised = (button && variant !== 'ghost') || raisedClass.test(text)
        const m = raised ? raisedClash.exec(text) : button || pressableClass.test(text) ? flatClash.exec(text) : null
        if (m) problems.push(`${f.name}:${n.loc.start.line} <${n.tag}> ${m[2]}`)
      }
    }
    expect(problems).toEqual([])
  })

  it('accent-coloured text is text-accent-ink: text-primary fails contrast with some accents', () => {
    const problems = appFiles.flatMap((f) =>
      [...f.code.matchAll(/(^|[\s'"`:])text-primary(?!-)/gm)].map((m) => `${f.name}:${f.code.slice(0, m.index).split('\n').length}`),
    )
    expect(problems).toEqual([])
  })

  it('radii are on the scale: card 20, field 14, chip 10, circle (spec 4.2)', () => {
    const scale = new Set(['card', 'field', 'chip', 'full', 'none', 'thumb', 'icon', 'fab'])
    const sides = new Set(['t', 'b', 'l', 'r', 's', 'e', 'tl', 'tr', 'bl', 'br', 'ss', 'se', 'es', 'ee'])
    const onScale = (value: string): boolean => {
      const parts = value.split('-')
      return parts.length === 1 ? scale.has(parts[0]!) : parts.length === 2 && sides.has(parts[0]!) && scale.has(parts[1]!)
    }
    const problems = appFiles.flatMap((f) =>
      [...f.code.matchAll(/(?<=^|[\s'"`:])rounded(?:-([\w[\].-]+))?(?=$|[\s'"`])/gm)]
        .filter((m) => !m[1] || !onScale(m[1]))
        .map((m) => `${f.name}:${f.code.slice(0, m.index).split('\n').length} ${m[0]}`),
    )
    expect(problems).toEqual([])
  })
})

describe('owner fixes after Plan 8', () => {
  const ui = fileURLToPath(new URL('../app/components/ui/', import.meta.url))
  const floatingFiles = [
    'dropdown-menu/DropdownMenuContent.vue',
    'dropdown-menu/DropdownMenuSubContent.vue',
    'select/SelectContent.vue',
    'combobox/ComboboxList.vue',
  ]
  it.each(floatingFiles)('%s floats on a plain lifted shadow, not a neumorphic one', (file) => {
    const source = readFileSync(join(ui, file), 'utf8')
    expect(source).toMatch(/\bfloating\b/)
    expect(source).not.toMatch(/\braised-card\b/)
  })
  it('dark theme: hover keeps the resting shadow (only the colour changes until pressed)', () => {
    expect(dark['shadow-hover']).toBe('var(--shadow-dark)')
  })
  it('the shadow and the sink of a press share one duration and curve', () => {
    const block = /\.pressable \{[^}]*transition:([^;]*);/.exec(css)?.[1] ?? ''
    const shadow = /box-shadow\s+([^,]+)/.exec(block)?.[1]?.trim()
    const sink = /transform\s+([^,]+)/.exec(block)?.[1]?.trim()
    expect(shadow).toBeDefined()
    expect(shadow).toBe(sink)
  })
})
