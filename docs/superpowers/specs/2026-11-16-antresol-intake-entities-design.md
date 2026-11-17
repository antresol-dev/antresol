# Antresol — intakes that create folders, items and attributes: design

Date: 2026-11-16
Status: agreed with the owner in chat on 2026-11-16.
Builds on: `2026-11-13-antresol-intakes-design.md` (intakes), `2026-11-14-antresol-mcp-design.md` (MCP, draft tags). Branch `mcp` (not merged yet); this work continues there.

**[Claude's call]** marks a choice Claude made, not the owner. Everything else was decided by the owner.

---

## 1. Why

An intake draft is often AI content (the MCP server fills it from photos) that the person reviews before it touches the inventory. Today a draft can only create items and their variants, and only inside existing folders and with existing attributes. A stocktake of unfamiliar parts needs new folders and attributes too, and the AI should be able to set one photo on a new item instead of copying the same photo onto every variant.

So a draft becomes a small plan of what will be created, in dependency order:

**new folder → new item → new variants (lines with amounts)**, next to plain top-ups of existing items or variants.

Nothing in it is real until the person commits the intake. Then it all becomes real in one atomic write.

## 2. Goals, non-goals, anti-goals

### Goals
1. Draft folders, nestable (a draft folder may sit inside an existing folder or inside another draft folder). Only the draft's items and folders may reference them. They become real folders on commit.
2. A new item is a first-class entry of the draft with its own photo and description, not a side effect of a line.
3. Draft attributes (name, kind, unit, list values, SI prefixes), created on commit like draft tags. "New attribute" in the line sheet creates a draft attribute, not a real one (owner, 2026-11-16: drafts are mostly AI content to review; owner, 2026-11-17: it is written into the draft only together with the saved line, held in the sheet until then and dropped when the sheet closes without saving; one made from the "Will be created" block is written at once).
4. The intake screen shows at the top what the commit will create: folders (as a compact tree), attributes, items (expandable cards).
5. Photo rules (option B, owner's choice): the item photo lives on the new item; a new-variant line may carry its variant's photo; existing items and variants never get or change photos through an intake.
6. The MCP server can do all of the above.
7. Every inline create form inside a sheet gets a close (×) button (owner: the inline "New attribute" form in Add line has none; same for other such forms).

### Non-goals
- Changing existing items through an intake: no tags, attributes, description or photo changes on items or variants that already exist. Lines only top them up.
- Draft units (custom units), draft attribute "Show in lists" (pinned) **[Claude's call]** — set those later in Dictionaries.
- Moving or renaming existing folders from an intake.
- Committing or deleting drafts from the MCP (unchanged from the MCP spec).
- Adding options to an existing list attribute from a draft (owner, 2026-11-16: later). If a new item needs a list value the existing attribute lacks, the value stays empty and the assistant says so in the chat; the person adds the option in Dictionaries.
- Protecting new draft parts from older app/MCP versions that save the draft without them (owner, 2026-11-16: not needed — no real data yet; MVP migrations will be combined into one release). App and MCP ship together.

### Anti-goals
- Anything in a draft becomes real before commit (no `rev` change while editing a draft; deleting a draft leaves nothing behind).
- A commit that half-applies: some folders created, items missing.
- The same photo copied onto every variant by the AI because there is nowhere else to put it.
- A draft that silently loses its folders, attributes, item photos or descriptions on a backup/restore round trip (this exact bug happened with draft tags; see the MCP plan's outcome).
- A screen that becomes a wall of fields: the top blocks are compact and expand on demand.

## 3. Concepts

The draft (still one database record) holds, besides header and lines:

- **Draft folders**: id, name, parent (an existing folder, a draft folder of this draft, or the root). Nesting depth is unlimited, no cycles.
- **Draft attributes**: id, name, kind (number / list / text), unit and SI prefixes (number), options (list).
- **Draft tags**: as today (by name, created on commit).
- **New items**: id, name, folder (existing or draft folder), unit, description, photo, tags, attributes (existing or draft attributes; axes in order, shared values).
- **Lines**: unchanged in shape: an amount for an existing item/variant (top-up), a new value of an existing item, or an amount for a new item or one of its variants. Optional price, link, photo (rules in §5).

Lifetimes (owner-approved, 2026-11-16):
- A **new item lives on its own**: removing its last line does not remove it. It is removed explicitly from its card. A new item with no lines is created on commit with no stock.
- A **draft folder is removed explicitly** from the folders block. One that still contains a draft item or draft folder cannot be removed until they are moved or removed **[Claude's call, approved]**.
- A **draft attribute is removed explicitly** from the attributes block; while a new item uses it, it cannot be removed **[Claude's call, approved]**.
- **Draft tags** keep today's rule (live while a new item references them).

## 4. The intake screen

Owner's layout. Top to bottom:

```
LCSC · #WM2511-0042 · 12 Nov                 [📝 Details] [📁 New folder] [⋯]
Will be created
  Folders
    📁 Passives
       📁 Inductors
  Attributes
    Inductance · number, H, SI prefixes                       ✎ ×
  Items
    [photo] Inductor 0805 · Passives / Inductors               ▸
            Inductance: 1 µH · 4.7 µH · 10 µH
Lines
  20  Inductor 0805 · 1 µH        NEW VALUE
  20  Inductor 0805 · 4.7 µH      NEW VALUE
 +10  Resistor 0.25 W · 4.7 kΩ    ADD
[+ Add line]                                   [Commit · 3 lines]
```

- **"New folder"** is a button in the screen header next to "Details". It opens a small sheet: name and parent (existing folders tree plus this draft's folders).
- **Folders block**: the draft folders as a compact tree under their nearest existing parent (show that parent's path for context). Tap a folder to rename / change parent / remove.
- **Attributes block**: one compact row per draft attribute (name, kind, unit). Edit opens the same attribute form as Dictionaries, in draft mode.
- **Items block**: one card per new item, collapsed to a row: thumbnail (or an empty photo slot), name, folder path, and the item's variant values from the lines, without amounts. Expanded: photo (set / replace / remove right there), name, folder, description, unit, tags, attributes, and the variants list (values only). Item photo can be set from the card. "Remove item" lives in the expanded card; it removes its lines too, with Undo **[Claude's call]**.
- The blocks are hidden when empty. On a committed intake they show what was created (§7).
- Lines list: unchanged rows, plus the existing labels ADD / NEW / NEW VALUE.

### Line sheet changes
- Folder choice for a new item lists draft folders too (chips and the "Other…" tree), marked as new.
- "New attribute" in the attributes section creates a **draft** attribute (same form, draft mode); the attribute picker lists draft attributes too, marked as new.
- Item photo vs line photo (option B):
  - new item without variants: the line's photo field **is** the item photo (same value as the card's photo);
  - new variant (of a new or existing item): the line's photo is that variant's photo;
  - top-up of an existing item or variant: no photo field. "Replace photo" is removed.
- Description field for a new item (folded, like Price & link) **[Claude's call]**.

### No duplicates (owner, 2026-11-16)
- A draft folder may not have the same name (trim, case-insensitive) as an existing or draft folder under the same parent. A draft attribute may not have the same name as an existing or draft attribute.
- **In the app** a duplicate cannot be created: while the name is typed, the form offers the existing folder/attribute ("Use existing Inductors"), and saving a duplicate is not possible.
- **In the MCP** creating a duplicate is an error that names the existing folder/attribute (with its id or path), so the assistant uses it instead.
- **At commit**, a duplicate that appeared meanwhile (e.g. the person created the same folder in the app) blocks the commit with a clear marking on the draft folder/attribute and a "Use existing" action that re-points the draft's references to the existing one.
- Draft tags keep today's rule (a name equal to an existing tag reuses it).

### Close buttons
Every inline create form that appears inside a sheet (the attribute form in Add line, and the other inline create forms of that kind, e.g. new unit / new tag where they exist) gets a visible × that cancels it, like the sheet's own close button.

## 5. Photo rules (precise)
- A new item has at most one item photo (goes to the item's gallery on commit).
- A new variant line may have one photo (the variant's photo on commit).
- **One line per created variant** (owner, 2026-11-16): two lines may not create the same new variant (same item, same axis values), and a new item without variants has at most one line. This replaces the intakes spec's "the same thing twice is allowed with a warning, the variant is created once" for creating lines. In the app, the sheet shows "Already in this intake" with "Edit that line" instead of saving a second one; the MCP refuses such a line with an error naming the existing line. A draft that still has two such lines (saved before) blocks the commit with a marking on the second line. Top-up lines of existing items/variants keep today's rule (allowed twice, with the warning) **[Claude's call]**.
- A new item without variants: the line photo and the item photo are one field.
- Lines that top up existing items/variants carry no photo. Drafts saved before this change that do have such photos keep committing them as before (backward compatibility); the UI shows them but cannot add new ones **[Claude's call]**.
- Uploading is unchanged: the photo is uploaded to the source's photo store when set; the draft stores the link.

## 6. MCP
The server gains, under the same rules as today (drafts only, never forced, all-or-nothing per call, the app's texts for errors):
- create, edit and remove draft folders (nested; parent by id or path, existing or draft);
- create, edit and remove draft attributes;
- new items with description and photo; a new item may be created without lines; remove a new item;
- line photos only where §5 allows (refuse a photo on a top-up line with a clear message);
- `get_intake` shows the draft folders, attributes and items with their photos; `get_overview` is unchanged (real data only).
- The `intake_from_photos` prompt: one photo per new item on the item, variant photos only when the variant really looks different; create folders/attributes only when nothing existing fits.
Tool names and shapes are the builder's.

## 7. Commit
- One atomic `intake.commit`, in order: draft folders (parents first), draft attributes, draft tags, new items (with their item photo, description, tags, attributes), new variants (with variant photos), unarchived variants, receipts. The source revision changes once.
- Retries are safe as today: every insert is idempotent by id; a retried commit creates nothing twice.
- A draft with no lines may be committed when it creates something (folders, attributes, items without stock) **[owner: allowed, rare]**. The commit button then names what it does (e.g. "Commit · 2 items") instead of "Commit · N lines"; with no lines and nothing to create it stays disabled.
- Checked again against the current database before writing, all-or-nothing with clear marking of what blocks it (today's rule), including: a draft folder whose existing parent was archived or deleted; a draft attribute referenced with a value that doesn't fit its kind; nothing referencing a removed draft entity.
- The committed intake keeps a record of what it created (folder, attribute, tag and item names at commit time, with ids), so the committed screen can show "Created" next to the lines even for items without lines. Storage of that record is the builder's (an additive migration is fine; `min_app_schema` must stay where it is).

## 8. Backups
Draft folders, draft attributes, new item photos and descriptions, and the committed "created" record are part of the backup and survive export → parse → restore, including restore with new ids (every id and reference renamed, `custom:` unit keys as today). Older backups still restore.

## 9. Compatibility
- Drafts saved before this change read as having no draft folders/attributes, no item photo or description; their new items keep today's semantics except that they no longer vanish with their last line.
- Draft fields are optional in the stored JSON; absent means empty.

## 10. Left to the builder
- Field names, the draft JSON shape, command shape, storage of the created record.
- Component structure (cards, folder sheet), exact copy (English, `intakes.*` keys).
- MCP tool names and argument shapes.
- Order of work and task split.
