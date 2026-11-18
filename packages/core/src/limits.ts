/** Rules shared by the commands' validation and the forms that check before sending (an intake line, spec 2026-11-13
 *  intakes §7: a line the commit would refuse is refused when saved, or marked). */

/** The longest name of an item, folder, tag, attribute, unit or inventory, trimmed. */
export const MAX_NAME_LENGTH = 200

/** Attributes of one inventory shown in lists ("Show in lists"). */
export const MAX_PINNED_ATTRIBUTES = 2

/** Photos of one new item of an intake draft (the draft is one jsonb record; MCP uploads them one by one). */
export const MAX_DRAFT_ITEM_PHOTOS = 20

/** The longest unit of a number attribute, trimmed. */
export const MAX_ATTRIBUTE_UNIT_LENGTH = 16

/** The name of an item's or folder's icon: lowercase words with hyphens. The set of names lives in the app. */
export function isIconName(name: string): boolean {
  return /^[a-z0-9-]{1,40}$/.test(name)
}

/** A colour of an item or tag: #RRGGBB, capitals. The palette lives in the app; any such hex is stored. */
export function isColorHex(v: string): boolean {
  return /^#[0-9A-F]{6}$/.test(v)
}

/** A source link: an http or https address. */
export function isSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
