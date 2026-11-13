/** Rules shared by the commands' validation and the forms that check before sending (an intake line, spec 2026-11-13
 *  intakes §7: a line the commit would refuse is refused when saved, or marked). */

/** The longest name of an item, folder, tag, attribute, unit or inventory, trimmed. */
export const MAX_NAME_LENGTH = 200

/** A source link: an http or https address. */
export function isSourceUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
