# Antresol — intakes create everything an item needs; no hard duplicates anywhere: design

Date: 2026-11-17
Status: agreed with the owner in chat on 2026-11-17.
Builds on: `2026-11-16-antresol-intake-entities-design.md` (draft folders, attributes, standalone items), `2026-11-14-antresol-mcp-design.md` (MCP), `2026-11-13-antresol-intakes-design.md`. Branch `mcp` (not merged yet); this work continues there.

**[Claude's call]** marks a choice Claude made, not the owner. Everything else was decided by the owner.

---

## 1. Why

The owner wants an AI assistant (through the MCP) to fill an intake completely: everything a new item needs, so the person only reviews and commits. Today a draft cannot set an item's icon or colour, a folder's icon, a custom unit, "Show in lists" on a new attribute, a new value in an existing list attribute, or a new variant's description. Attributes are also created separately from the items that need them, which invites unused or duplicate entries.

At the same time the inventory must not fill up with duplicates. Exact duplicates (same name) are refused by code everywhere in the app; near duplicates are the assistant's job to avoid, so the server must give it the information.

## 2. Goals, non-goals, anti-goals

### Goals
1. A draft new item carries an icon and a colour; a draft folder carries an icon; a draft tag carries a colour.
2. A draft can declare a custom unit (name, symbol, prefixes) used by its new items.
3. A draft attribute can be "Show in lists".
4. A draft can add a value to an existing list attribute (the value is appended on commit).
5. A new variant (a line that creates it) carries a description.
6. Attributes, tags and units are declared only **inside a new item**, when that item needs them — never on their own. They live while a draft item uses them and are shown at the top under "Will be created", like folders and items.
7. Hard duplicates are refused by the core, for every write in the whole app (§3).
8. The MCP tells the assistant about near duplicates, so it can avoid them.
9. Everything is created by the one atomic `intake.commit`; a retried commit creates nothing twice.

### Non-goals
- Folder colours (the app has none).
- Changing existing items, variants, attributes (except appending list values, goal 4), tags or units through an intake.
- Merging or cleaning duplicates that already exist in the data.
- Fuzzy-matching rules beyond §5 (no external dictionaries or language models in the server).

### Anti-goals
- Any of the new parts becomes real before commit, or changes `rev` while a draft is edited.
- A hard duplicate created by any path: app forms, quick add, rename, move, restore from archive, intake commit, MCP.
- An attribute, tag or unit created that no item uses.
- A commit that half-applies.
- Draft parts lost on backup/restore round trips (including restore with new ids).

## 3. Hard duplicates (owner, 2026-11-17: variant C, whole app)

A **hard duplicate** is a name equal to another one after trimming spaces at both ends and ignoring letter case (the same comparison as tags today, core `sameName`).

| Entity | Must be unique among |
|---|---|
| Item | all items in the same folder, **archived ones included** (owner, 2026-11-17); root counts as a folder |
| Folder | all folders with the same parent, archived ones included **[Claude's call, following the owner's rule for items]** |
| Attribute | all attributes of the inventory |
| Tag | all tags of the inventory (already enforced) |
| Custom unit | all custom units of the inventory **and the built-in units** (owner, 2026-11-17), by name (case-insensitive, like everything else) **and** by symbol — the symbol compared **case-sensitively** ("m" ≠ "M", "ml" ≠ "mL"; "M" is also the mega prefix) |

- Enforced in the core's command validation (`duplicate_name`) only — **no database-level guard for now** (owner, 2026-11-17); two devices writing at the same moment could still race, which is accepted. Every path goes through it: item.create / item.update (rename) / item.move, folder.create / folder.update / folder.move, attribute.create / attribute.update, unit.create / unit.update, tag.*, and `intake.commit` (new entities against the copy **and** against each other).
- **Archived items and folders block the name** (owner, 2026-11-17: it must not be possible to create an item duplicating an archived one). The refusal says so ("An archived item “X” is in this folder — restore it or choose another name"). Since a name can't be taken while its archived twin exists, restoring never meets a duplicate made later; restore keeps a plain `duplicate_name` check for data made before this rule.
- Duplicates already in the data stay; the rule only applies to the change being made **[Claude's call]** (the owner has no real data yet).
- The app shows the refusal in the form that caused it (the existing error text for `duplicate_name`), and where a form can know beforehand (name fields of item, folder, attribute, unit, tag) it says so while typing and offers the existing one when that makes sense ("Use existing" in intake drafts, as today).
- Variants are unaffected (they are already unique by their axis values).

## 4. Draft model and lifetimes

Additions to the draft (stored JSON, all optional; absent = empty):

- **New item**: `icon` (icon name), `color` (#RRGGBB) — same rules as `item.create`.
- **Draft folder**: `icon`.
- **Draft tag**: `color`.
- **Draft unit**: id, name, symbol, prefixes (the powers the unit form offers). A new item may use it as its unit (`custom:<draft unit id>`).
- **Draft attribute**: `pinned` ("Show in lists").
- **Added list values**: for an existing list attribute, the values the draft appends (in the order given). Any line may use them — of a new item **or of an existing item** (e.g. a new variant whose list axis lacks "0805") (owner, 2026-11-17).
- **New-variant description**: on the line that creates the variant (the first and only such line, per "one line per created variant").

Lifetimes:
- Draft **attributes, tags and units** exist only because a new item uses them; **added list values** exist because a line (of any item) or a new item uses them. They are declared from the item (app: the line sheet / item card; MCP: inside the new item) and are **dropped automatically** when no draft item uses them any more (like draft tags today). There is no standalone creation in the app or the MCP. They can be edited from the "Will be created" block.
- Draft **folders** and **items** keep their explicit lifetimes (created and removed explicitly).

## 5. Near duplicates (assistant's job, server helps)

- Every MCP write that names something new (item, folder, attribute, tag, unit, added list value) answers with a `similar` list per new name: existing (and draft) names that are near but not equal **[Claude's call on the rule]**:
  - same after removing spaces, hyphens, dots and underscores;
  - same after a simple singular/plural fold (trailing "s"/"es");
  - edit distance ≤ 2 for names of 6+ characters (≤ 1 for shorter);
  - one contains the other as a whole word.
  It is advice, not a refusal. Items are compared within the same folder and across the inventory (the cross-folder ones flagged as such).
- `get_overview` already lists all folders, attributes, tags and units; it also lists list attributes' values.
- The prompt and tool descriptions tell the assistant: check `similar` and the overview before creating; prefer existing; never rely on case or spacing variants.
- The app shows the same near-duplicate hint where it already shows "Looks like you already have this" (no new UI beyond that) **[Claude's call]**.

## 6. App UI

- **"Will be created"** gets blocks for units, attributes (now including "Show in lists"), tags (with colour) and added list values ("Package: + 0805"), next to folders and items. Each row can be edited; none can be created there; removal happens by removing their use from the items (a row may offer "Remove from all items" **[Claude's call]**).
- **New item card** and line sheet: icon and colour pickers (the app's existing IconField and ColorSwatches, as in the item form); unit picker offers "New unit…" (draft unit form, the existing unit form in draft mode); attribute picker offers "New attribute…" (draft); for an existing list attribute the value field offers "Add “0805” to the list" (draft) — in the line sheet of an existing item too.
- **Draft folder sheet**: icon picker.
- **Line sheet for a new variant**: a description field (folded, like Price & link).
- **Committed intake "Created"** lists units and added list values too.
- Design system rules apply (`docs/superpowers/plans/2026-11-13-antresol-12-design-system.md`).

## 7. MCP

- `create_attribute`, `update_attribute`, `remove_attribute` are removed. New items in `add_intake_lines` / `update_new_item` declare what they need inline: attributes (full definition when new, incl. `pinned`), tags (by name; new ones with an optional colour), unit (existing key/symbol or a new unit definition), added values for existing list attributes, `icon`, `color`.
- Lines that create a variant accept `description`. Lines (of new or existing items) may declare values to add to an existing list attribute.
- `create_folder` / `update_folder` accept `icon`.
- Hard duplicates are refused with the app's text naming the existing entity (id, path).
- Every write returns `similar` (§5). `get_overview` adds list values and units' prefixes.
- The `intake_from_photos` prompt follows §5 and the "declare under the item" rule.

## 8. Commit

One atomic `intake.commit`, in order: folders (parents first, with icons), units, attributes (with pinned), tags (with colours), appended list values (`attribute.update`-like, append only, skipping values already present), items (with icon, colour, description, unit), variants (with description), photos, receipts. Checked again against the database: hard duplicates (§3), the pinned limit (`MAX_PINNED_ATTRIBUTES`), unit and colour/icon validity; all-or-nothing with clear marking. The committed "created" record lists units and appended values too.

## 9. Backups

All new draft parts and the extended created record survive export → parse → restore, including restore with new ids (`custom:<id>` unit keys renamed as today). Older backups restore unchanged.

## 10. Left to the builder

- Field names, JSON shapes, command fields, the near-duplicate implementation (within §5's rules), component structure, copy (English), MCP argument shapes.
- Order of work and task split.
