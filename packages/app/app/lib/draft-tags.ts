import { sameName, type Id } from '@antresol/core'

type Named = { id: Id; name: string }

/** A draft tag whose name is now a real tag's (trim, no case) is that tag: draft id -> real id. A new item keeps the
 *  draft id until it is saved again, so the picker reads it as the real tag. */
export function draftTagAliases(real: readonly Named[], draftTags: readonly Named[]): Map<Id, Id> {
  const out = new Map<Id, Id>()
  for (const d of draftTags) {
    const hit = real.find((t) => sameName(t.name, d.name))
    if (hit) out.set(d.id, hit.id)
  }
  return out
}

/** The tag counts as picked when its own id is selected or a draft tag that is the same tag. */
export function tagPicked(selected: readonly Id[], id: Id, aliases: ReadonlyMap<Id, Id>): boolean {
  return selected.includes(id) || selected.some((x) => aliases.get(x) === id)
}

/** The selection after ticking (adds the tag's own id only) or unticking (removes its id and the draft ids that are the same tag). */
export function togglePicked(selected: readonly Id[], id: Id, on: boolean, aliases: ReadonlyMap<Id, Id>): Id[] {
  const rest = selected.filter((x) => x !== id && aliases.get(x) !== id)
  return on ? [...rest, id] : rest
}
