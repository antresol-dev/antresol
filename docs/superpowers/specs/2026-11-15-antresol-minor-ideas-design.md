# Minor ideas: item and tag colours, search across inventories

Short design (small change). Source: proposals.md, "New minor ideas (2026-11-15)". Branch `minor-ideas`, from master
4ac38dc (structural-ux merged: icons, thumb tones by id, migration 0004).

## Intent

- Let the owner give an item a colour of their own, picked together with its icon, so things they care about read at a
  glance; let them colour tags the same way.
- Let the command palette find things in every inventory, not only the one that is open.

## Approaches considered

- **Colours: the Appearance accent palette, stored as a literal hex (picked by the owner).** The colours of Settings →
  Appearance → Accent (`ACCENTS` in lib/accent.ts: indigo, violet, blue, sky, teal, green, orange, rose, pink, slate,
  copper). The palette may grow; a stored colour must not depend on it, so the value kept is the hex itself.
- The style's six thumb tones (`thumbTones`), stored as a number: rejected by the owner, too few, and tied to the style.
- A free colour picker (any hex the user types): not wanted; the choice is the palette's swatches, the hex is only how it
  is stored.

## Item colour (owner's decisions)

- The choices: the accent palette. Default (nothing chosen): a palette colour picked from the item's id.
- Picked together with the icon, in the item form.
- An item with a photo: the colour only draws a frame around the photo thumbnail.
- An item with an icon: the colour sets both the frame and the icon's colour.
- Variants get no colour of their own and have no colour setting.

## Tag colour

- The same palette, stored the same way. A coloured tag is a chip in that colour wherever tag chips show: item card, tag
  picker, Dictionaries → Tags.

## Search across inventories (owner's decisions)

- For now a toggle chip in the palette. Later the owner plans a separate "Advanced search" page with deep filters; then
  the chip goes away and the palette gets an action at the end of its results, "Search in all inventories", that opens
  that page. Nothing of the page is built now; the chip's search logic should be reusable by it.

## Calls I made (check these)

1. **Stored value**: `items.color` and `tags.color`, nullable text, `#RRGGBB` upper-case (validated in core and by a
   check in the database). The value kept is the palette colour's light-theme hex (`ACCENTS[name].light`). null on an
   item means "from the id"; null on a tag means a plain grey chip, as today.
2. **Dark theme**: a stored hex that is a palette colour uses that colour's own dark shade (`ACCENTS[name].dark`); any
   other hex (a colour later dropped from the palette, or written by the MCP) gets the palette's rule, the colour mixed
   55 % towards white (every palette colour but copper follows it exactly).
3. **The default from the id moves to the accent palette too**: the item's id picks one of the palette colours
   (`thumbTone(id, ACCENT_NAMES.length)`), so a chosen and a default colour look alike. The style's six `thumbTones`
   stop being used for item thumbnails. This changes the look of every thumbnail made since structural-ux, including in
   Neo-brutal and Retro, which keep their fixed accent but whose thumbnails take palette colours.
4. **How a colour draws a thumbnail** (the same for chosen and default colours): an icon or letters in the colour on a
   pale tint of it (the colour mixed into the surface, about 85 % surface in light, 80 % in dark), with a 1.5 px frame
   in the colour drawn inside the thumbnail so sizes don't change. A photo: the photo with the same frame. So photo
   thumbnails, which have no frame today, all get one.
5. **Tags stay grey by default** (no colour from the id), otherwise every existing tag would turn colourful at once.
   A coloured tag chip: the colour's tint as background, the colour as text.
6. **The picker**: a row of round swatches right under the Icon row of the item form: "Auto" first (shows the id's colour,
   marked as auto), then the palette, in the Settings → Appearance order and look. The Icon row's preview icon takes the
   chosen colour. The tag edit form gets the same row with "None" instead of "Auto". A stored hex that is no longer in
   the palette shows as an extra selected swatch at the end, so it is not lost silently.
7. **The colour belongs to the item.** A new item made from an intake draft gets "Auto".
8. **Search across inventories**: the chip sits next to the inventory name in the palette ("All inventories"), and is
   remembered on this device. On: items and folders from the open inventory (live) and from the copies of the other
   inventories saved on this device; archived inventories are left out. Rows from another inventory carry its name in
   the path line ("Workshop · Box 3"); the open inventory's results come first. Opening such a row switches to that
   inventory and opens the item or folder. Actions (add item, new folder, …) stay the open inventory's. Inventories
   never opened on this device are not searched; a muted line under the results says how many were skipped.

## Non-goals

- Colours for folders; a free colour picker; per-variant colours.
- The Advanced search page.
- Loading inventories that are not on the device just to search them.

## Constraints

- Migration 0005 (additive, `min_app_schema` unchanged, as 0004 did); validation in core; create/update commands for
  items and tags take `color`; backups and restore keep it. The MCP branch shares `@antresol/kit`; its item and tag
  writes will need `color` passed through when it merges.
- Follow the icons feature (d7bcaef, 54bd865, daa82c8) as the template for the data path and the form row.

## Left to the builder

- Swatch look per style (selected ring, focus), keyboard and screen-reader labels (the palette names, as in Appearance).
- Exact placement of the toggle chip on the phone layout.
