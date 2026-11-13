import type { AccentName } from '../accent'

/*
 * The style contract (spec 2026-11-12 §3–§5). A style is a TypeScript module whose build(mode, accent) returns one
 * StyleTokens object; apply.ts writes it as CSS variables (--st-<key in kebab-case>) and main.css's utilities read
 * nothing else. A style changes colour, radius, shadow, type, motion and icon stroke only — never padding, margin, gap,
 * width or height: borders are inset box-shadows, decorations are background layers or absolutely positioned.
 *
 * Two groups of keys:
 *  - MockupTokens: the owner's mock-up's `k` object (styles-mockup.dc.html, build()), key for key. A style ports its
 *    branch of build() verbatim into these.
 *  - AppSurfaces: surfaces the app has and the mock-up's item screen does not (sheets, fields, tooltips, toasts…).
 *    derive.ts (deriveSurfaces) fills each from the mock-up keys by the rules of spec §5; a style sets one only when
 *    the derived value looks wrong in it.
 *
 * Value kinds: a "colour" is #hex, rgb()/rgba() or `transparent`; a "background" is any CSS `background` value (layers,
 * gradients, a colour last); a "shadow" is a box-shadow list or `none`; a "radius" is a border-radius value.
 */

export type StyleName = 'base' | 'neumorphism' | 'acrylic' | 'liquid' | 'linear' | 'brutal' | 'y2k' | 'retro' | 'tinkerer'
export type Mode = 'light' | 'dark'

/** The six control roles of the mock-up. */
export type KindName = 'ib' | 'add' | 'btn' | 'primary' | 'step' | 'ghost'

/** One state of a control. */
export interface KindState {
  /** background-color (a colour). */
  bg: string
  /** background-image over it (gradients) or 'none'. */
  img: string
  /** box-shadow or 'none'. */
  sh: string
  /** Text and icon colour. */
  fg: string
  /** transform ('none', 'scale(0.97)', 'translate(3px, 3px)'): only under prefers-reduced-motion: no-preference. */
  tf: string
}

/** A control's rest (n), hover (h) and pressed (p) states. */
export interface Kind {
  n: KindState
  h: KindState
  p: KindState
}

/** The mock-up's `k`: every key its build() fills, in its order. */
export interface MockupTokens {
  // ---- Type ----
  /** font-family of the body text. */
  font: string
  /** font-family of the screen title (h1). */
  headFont: string
  /** The mock-up's title size. NOT applied in the app: sizes are the markup's (spec §3: a style changes weights, not
   *  sizes); for previews only. */
  headSize: string
  /** font-weight of the screen title. */
  headWeight: string
  /** letter-spacing of the screen title. */
  headTrack: string
  /** text-transform of the screen title ('none' | 'uppercase'). */
  headCase: string
  /** font-family of section labels ("Variants", "Attributes", settings section headings). */
  labelFont: string
  /** The mock-up's label size. NOT applied in the app: sizes are the markup's (spec §3); for previews only. */
  labelSize: string
  /** font-weight of section labels. */
  labelWeight: string
  /** text-transform of section labels. */
  labelCase: string
  /** letter-spacing of section labels. */
  labelTrack: string
  /** A mark before every section label ('✦ ', '// '), '' for none. */
  mark: string
  /** Colour of the mark ('inherit' = the label's). */
  markColor: string
  /** font-family of numbers (every .tabular-nums element); 'inherit' keeps the body font. */
  numFont: string
  /** font-weight of the amounts the mock-up draws in numFont (.amount: the stock total, the stepper's count, list and
   *  history amounts). */
  numWeight: string
  /** font-family of tag chips; 'inherit' keeps the body font. */
  chipFont: string
  /** font-weight of the labelled actions the mock-up draws (.btn-label: "Add variants", "Add attribute", "Edit",
   *  "Add item"…). Other buttons take plainBtnWeight. */
  btnWeight: string

  // ---- Icons (Lucide) ----
  /** stroke-width of icons drawn at Lucide's default 2 ('1.5'…'2.5'). Icons with their own width keep it. */
  stroke: string
  /** stroke-linecap: 'round' | 'square'. */
  cap: string
  /** stroke-linejoin: 'round' | 'miter'. */
  join: string

  // ---- Blur (backdrop-filter values or 'none'; the high-contrast fallback drops every one of them) ----
  /** The window layer over the page (Acrylic's Mica): a colour drawn over `page` behind all content… */
  winBg: string
  /** …and the blur it applies to the page. */
  winBlur: string
  /** Header blur (needs a translucent `hdr`). */
  hdrBlur: string
  /** Blur of cards, lists, the photo and thumbnails (needs translucent surfaces). */
  surfBlur: string
  /** Blur of raised controls and the stepper pill. */
  ctrlBlur: string
  /** Blur of menus, select lists, combobox lists. */
  popBlur: string

  // ---- Status LED (Tinkerer) ----
  /** The stock card carries a status LED (drawn by the style's own CSS on .stock-card). */
  led: boolean
  /** LED colour. */
  ledColor: string
  /** LED glow (a shadow). */
  ledGlow: string

  // ---- Page and text ----
  /** The page: a background (patterns and wallpapers included). */
  page: string
  /** Body text colour. */
  fg: string
  /** Secondary text (descriptions, units, captions). */
  muted: string
  /** Section labels and meta lines. */
  subtle: string
  /** Icon colour of flat icon buttons and list rows. */
  icon: string
  /** Text of an out-of-stock row. */
  dimmed: string
  /** Accent-coloured text on the page (links, hover ink, the selected row's ink unless curFg differs). */
  ink: string

  // ---- Header ----
  /** Header background. */
  hdr: string
  /** Header shadow (its bottom line is usually `inset 0 -1px 0 <colour>`). */
  hdrSh: string

  // ---- Photo block ----
  /** The cover photo's backing (a background). */
  photo: string
  /** Its shadow. */
  photoSh: string
  /** Its radius. */
  photoR: string
  /** Its placeholder text/icon colour. */
  photoFg: string
  /** Thumbnail backings, cycled by position (--st-thumbs-0, -1…; the style's CSS cycles beyond the first). */
  thumbs: string[]
  /** Thumbnail placeholder colour (also --thumb-foreground). */
  thumbFg: string
  /** Thumbnail shadow. */
  thumbSh: string
  /** Thumbnail radius. */
  thumbR: string

  // ---- Tag chips ----
  /** Tag chip backgrounds, cycled by position (--st-chips-0…). */
  chips: string[]
  /** Tag chip text colours, cycled (--st-chip-fgs-0…). */
  chipFgs: string[]
  /** Tag chip shadow. */
  chipSh: string
  /** Tag chip radius. */
  chipR: string

  // ---- Card (stock card, settings cards) ----
  /** Card background. */
  card: string
  /** Card shadow. */
  cardSh: string
  /** Card radius (also the app's --radius-card: sheets, palette, dialogs). */
  cardR: string
  /** Text colour on the card. */
  cardFg: string
  /** Secondary text on the card. */
  cardMuted: string

  // ---- Lists (variants, attributes, history, folder and item lists) ----
  /** List background ('transparent': rows lie on the page). */
  list: string
  /** List shadow. */
  listSh: string
  /** List radius. */
  listR: string
  /** Row divider, a border shorthand '1px solid <colour>' (always 1px: it is drawn as a 1 px line). */
  divider: string

  // ---- Selected row (current variant, tree folder, palette row, nav link) ----
  /** Selected row background. */
  cur: string
  /** Selected row shadow (its ring). */
  curSh: string
  /** Selected row radius. */
  curR: string
  /** The selected row's inset from the list's edges, as the mock-up's margin ('0', '0 6px'). Drawn, not laid out: the
   *  row keeps its box; its background and ring are inset by this much. */
  curM: string
  /** Text and icon colour on the selected row. */
  curFg: string
  /** Secondary text on the selected row. */
  curMuted: string

  // ---- Stepper pill [− | +] ----
  /** Pill background colour. */
  pillBg: string
  /** Pill background image ('none' or a gradient). */
  pillImg: string
  /** Pill shadow. */
  pillSh: string
  /** Pill radius. */
  pillR: string
  /** The line between the halves, a border shorthand '1px <style> <colour>' (always 1px). */
  seam: string
  /** Pill background on the selected row. */
  pillSelBg: string
  /** Pill shadow on the selected row. */
  pillSelSh: string
  /** Radius of the left half (the pill's outer corners only). Filled by finish() from pillR. */
  pillRL: string
  /** Radius of the right half. Filled by finish() from pillR. */
  pillRR: string

  // ---- Control radii ----
  /** Icon buttons and the add tile (.raised-sm, .add-tile). */
  ibR: string
  /** Secondary buttons (.raised) and fields (the app's --radius-field). */
  btnR: string
  /** The primary button (.accent-button). */
  primR: string
  /** Flat controls (.pressable alone). */
  ghostR: string

  // ---- Menus, select lists, combobox lists (and, derived, tooltips) ----
  /** Menu background. */
  pop: string
  /** Menu shadow. */
  popSh: string
  /** Menu radius. */
  popR: string
  /** Menu text. */
  popFg: string
  /** Hovered/focused item background. */
  popHover: string
  /** Hovered/focused item text. */
  popHoverFg: string
  /** Destructive item text. */
  popDanger: string
  /** Separator colour. */
  popDiv: string
  /** Item radius. */
  popItemR: string

  // ---- Motion ----
  /** transition of every control (hover and press only; sheets and menus animate the same in every style). */
  tr: string

  // ---- Controls ----
  /** The six roles: ib (icon buttons, .raised-sm), add (the add-photo tile, .add-tile), btn (secondary, .raised),
   *  primary (.accent-button), step (the stepper's halves, .pill-step), ghost (flat controls, .pressable alone). */
  kinds: Record<KindName, Kind>
  /** The stepper's halves on the selected row. finish() defaults it to kinds.step. */
  stepSel: Kind
  /** Flat controls on the selected row. finish() defaults it to kinds.ghost with curMuted as the rest text (the row's
   *  muted colour, which is what the "⋯" in it shows). */
  ghostSel: Kind
}

/** App surfaces the mock-up does not draw; deriveSurfaces fills every one a style leaves out. */
export interface AppSurfaces {
  /** One opaque colour for the page (--background): sticky bars, the dock's fade, text drawn in the page colour.
   *  Default: `page`'s colour under `winBg`. */
  pageColor: string
  /** The accent of this mode, for tints (--accent). Default: kinds.primary.n.bg made opaque. */
  accent: string
  /** Soft accent fill: folder icons, palette chips, badges, changed rows (--accent-soft). Default: accent 12 % (16 %
   *  dark) on `surface`. */
  accentSoft: string
  /** Text on accentSoft. Default: ink. */
  accentSoftFg: string
  /** Checkbox, switch, radio and progress fill (--primary). Default: accent. */
  primary: string
  /** Text/check on `primary`. Default: kinds.primary.n.fg. */
  primaryFg: string
  /** Keyboard focus ring (--ring). Default: ink. */
  ring: string
  /** A surface painted in the accent (.painted). Default: kinds.primary. */
  painted: Kind
  /** The destructive button (.painted-destructive): destructive paint with destructiveFg text. Default: flat
   *  destructive paint, 8 % / 12 % darker on hover / press, the primary's press transform. */
  paintedDanger: Kind
  /** Destructive text on the page (--destructive). Default: popDanger. */
  destructive: string
  /** Text on the destructive paint (--destructive-foreground). Default: white (light), #16181D (dark). */
  destructiveFg: string
  /** Warning text (--warning). Default: #92400E light, #FBBF24 dark. */
  warning: string
  /** A list row under the pointer (--hover, hover:bg-hover). Default: kinds.ghost.h.bg. */
  rowHover: string
  /** Neutral chip fill: pinned values, skeletons, the switch's off track (--chip). Default: chips[0]. */
  chip: string
  /** Photo and thumbnail backing in lists (--thumb). Default: thumbs[0]. */
  thumb: string
  /** An opaque surface: the desktop tree panel, badges, shadcn's --card (--surface). Default: `card` made opaque. */
  surface: string
  /** The desktop sidebar and the navigation drawer (--rail). A translucent tint is laid over pageColor (the rail is
   *  always opaque: the drawer covers the page). Default: pageColor. */
  rail: string
  /** The desktop sidebar's right edge (--st-rail-line), a border shorthand ("1px solid …", or "none" where the rail's own
   *  colour sets it apart). Default: 1 px of `border`. */
  railLine: string
  /** Generic line colour: outlines, the palette's border, `border` utilities (--border). Default: divider's colour. */
  border: string
  /** Row divider colour (--divider). Default: divider's colour. */
  dividerColor: string
  /** The folder tree's indent lines (--tree-line). Default: border. */
  treeLine: string
  /** Colour of the header's 1 px bottom border (the header draws its line with hdrSh instead when this is
   *  'transparent'). Default: 'transparent'. */
  hdrLine: string
  /** Text fields, textareas, select triggers, checkboxes (--field). Default: `list` made opaque (spec §5). */
  field: string
  /** Their 1 px border (--input). Default: the colour of listSh's inset ring, else border. */
  fieldLine: string
  /** Their shadow. Default: 'none'. */
  fieldSh: string
  /** Sheets and dialogs: background. Default: card (spec §5). */
  sheet: string
  /** Their shadow. Default: cardSh. */
  sheetSh: string
  /** Their 1 px border's colour (also the navigation drawer's edge in the dark theme). Default: 'transparent'; in the dark
   *  theme a 16 % white rim, so the edge does not vanish into the scrim. */
  sheetLine: string
  /** Their blur. Default: surfBlur. */
  sheetBlur: string
  /** The desktop search palette's window, a sheet: a layer drawn over the sheet's colour (--st-palette-img). Default:
   *  'none'. */
  paletteImg: string
  /** Its shadow. Default: Tailwind's shadow-2xl (what the window had). */
  paletteSh: string
  /** Its 1 px border's colour. Default: sheetLine. */
  paletteLine: string
  /** The scrim behind sheets and dialogs. Default: rgba(0,0,0,0.8). */
  overlay: string
  /** An opaque menu colour: menus without blur support or under high contrast, toasts (--popover). Default: `pop`
   *  made opaque. */
  popSolid: string
  /** The menu's 1 px border colour. Default: 'transparent'. */
  popBorder: string
  /** Muted text inside menus. Default: muted. */
  popMuted: string
  /** Tooltip background (a colour). Default: popSolid. */
  tip: string
  /** Tooltip text. Default: popFg. */
  tipFg: string
  /** Tooltip shadow. Default: popSh. */
  tipSh: string
  /** Small radius of nested things: chips, tooltips, crumb links, row menu buttons, folder icons, list thumbnails
   *  (the app's --radius-chip, --radius-thumb, --radius-icon). Default: ghostR. */
  smallR: string
  /** font-weight of every other button label (.btn-text: sheet and form buttons). Default: btnWeight. */
  plainBtnWeight: string
  /** Shadow of a bottom bar (.surface-bar: the count screen's sticky bar), which otherwise wears the header's surface
   *  (hdr, hdrBlur, its 1 px top border in hdrLine). Default: hdrSh mirrored top to bottom (its line on the top edge). */
  barSh: string
}

/** Everything a style gives the app. */
export type StyleTokens = MockupTokens & AppSurfaces

/** What a style's build() hands to finish(): the mock-up's keys (the shared fallbacks optional) and any app surface it
 *  wants to set itself. */
export type StyleSource = Omit<MockupTokens, 'pillSelBg' | 'pillSelSh' | 'pillRL' | 'pillRR' | 'stepSel' | 'ghostSel'> &
  Partial<Pick<MockupTokens, 'pillSelBg' | 'pillSelSh' | 'stepSel' | 'ghostSel'>> &
  Partial<AppSurfaces>

export type StyleBuild = (mode: Mode, accent: AccentName) => StyleTokens

export interface StyleInfo {
  name: StyleName
  label: string
  /** The style has its own colours: the accent choice is hidden and `build` ignores the accent it is given. */
  fixedPalette: boolean
  /** The accent while the user keeps "Style default". */
  defaultAccent: AccentName
  /** Font families the style uses (@nuxt/fonts serves them, nuxt.config.ts). */
  fonts: string[]
  build: StyleBuild
}
