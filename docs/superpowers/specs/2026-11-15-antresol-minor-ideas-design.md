# Minor ideas: item and tag colours, search across inventories

Short design (small change). Source: proposals.md, "New minor ideas (2026-11-15)". Branch `minor-ideas`, from master
4ac38dc (structural-ux merged: icons, thumb tones by id, migration 0004).

## Intent

- Let the owner give an item a colour of their own, picked together with its icon, so things they care about read at a
  glance; let them colour tags the same way.
- Let the command palette find things in every inventory, not only the one that is open.

## Approaches considered

- **Colours: the style's own six thumb tones (picked).** The palette every style already defines for light and dark
  (`thumbTones`, `--st-thumb-tone-<i>` / `--st-thumb-tone-fg-<i>`, Neo-brutal has its own six). A colour is stored as
  the tone's number. Every style and theme renders it, contrast stays right.
- Colours as any hex: rejected, it only looks right in the style and theme it was picked in.
- A larger named palette (adding red, orange, …): rejected by the owner, the six tones are enough.

## Item colour (owner's decisions)

- Six choices: the six tones. Default (nothing chosen): the tone from the item's id, as today (`thumbTone`).
- Picked together with the icon, in the item form.
- An item with a photo: the colour only draws a frame around the photo thumbnail.
- An item with an icon: the colour sets both the frame and the icon's colour.

## Tag colour

- The same six tones. A coloured tag is a chip in the tone (tone background, tone ink) wherever tag chips show: item
  card, tag picker, Dictionaries → Tags.

## Search across inventories

- An option in the palette to search all inventories instead of the current one.

## Calls I made (check these)

1. **Stored as a tone number 0–5, not a name.** Neo-brutal's six tones are different colours from the default six, so
   "blue" would be wrong there. `items.tone` and `tags.tone`: nullable smallint, check 0–5. null on an item means "by
   id"; null on a tag means a plain grey chip.
2. **Tags stay grey by default** (no tone from the id), otherwise every existing tag would suddenly turn colourful.
3. **The frame shows on every item thumbnail, including the default tone from the id.** So photo thumbnails, which have
   no frame today, all get a thin frame. The frame uses the tone's ink colour (`fg`), the background shade is too pale
   to see on a light surface. 1.5 px, drawn inside the thumbnail so sizes don't change. Thumbnails with an icon or letters
   keep the tone background, with the icon or letters and the frame in the tone ink.
4. **The picker**: a row of swatches right under the Icon row of the item form: "Auto" (the id's tone, marked as auto)
   and the six tones. The Icon row's preview icon takes the chosen colour. The tag edit form gets the same row with
   "None" instead of "Auto".
5. **The colour belongs to the item, not to a variant.** A new item made from an intake draft gets "Auto".
6. **Search across inventories**: a toggle chip in the palette next to the inventory name ("All inventories"),
   remembered on this device. On: items and folders from the open inventory (live) and from the copies of the other
   inventories saved on this device; archived inventories are left out. Rows from another inventory carry its name in
   the path line ("Workshop · Box 3"); the open inventory's results come first. Opening such a row switches to that
   inventory and opens the item or folder. Actions (add item, new folder, …) stay the open inventory's. Inventories
   never opened on this device are not searched; a muted line under the results names how many were skipped.

## Non-goals

- Colours for folders; any colour beyond the six tones; per-variant colours.
- Loading inventories that are not on the device just to search them.

## Constraints

- Migration 0005 (additive, `min_app_schema` unchanged, as 0004 did); validation in core; create/update commands for
  items and tags take `tone`; backups and restore keep it. The MCP branch shares `@antresol/kit`; its item and tag
  writes will need `tone` passed through when it merges.
- Follow the icons feature (d7bcaef, 54bd865, daa82c8) as the template for the data path and the form row.

## Left to the builder

- Swatch look per style (selected ring, focus), keyboard and screen-reader labels (tone names per index: "Tone 1…6"
  unless the style gives names).
- Exact placement of the toggle chip on the phone layout.
