import {
  BUILTIN_UNITS,
  customUnitKey,
  type Attribute,
  type CustomUnit,
  type InventorySnapshot,
  type Tag,
  type UnitDef,
} from '@graymatter/core'
import { byName } from './views'

export interface DictionaryView {
  tags: { tag: Tag; itemCount: number }[]
  attributes: { attribute: Attribute; itemCount: number }[]
  /** Built-ins first (custom: null), then custom units by name. */
  units: { unit: UnitDef; custom: CustomUnit | null; itemCount: number }[]
}

const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1)

/** Counts include archived items: deleting a tag, attribute or unit affects them too (core's unit_in_use counts them). */
export function dictionaryView(s: InventorySnapshot): DictionaryView {
  const tagCount = new Map<string, number>()
  const unitCount = new Map<string, number>()
  const attrCount = new Map<string, number>()
  const itemIds = new Set<string>()
  for (const i of s.items) {
    itemIds.add(i.id)
    for (const t of i.tagIds) bump(tagCount, t)
    bump(unitCount, i.unitKey)
  }
  for (const a of s.itemAttributes) if (itemIds.has(a.itemId)) bump(attrCount, a.attributeId)

  return {
    tags: [...s.tags]
      .sort(byName)
      .map((tag) => ({ tag, itemCount: tagCount.get(tag.id) ?? 0 })),
    attributes: [...s.attributes]
      .sort(byName)
      .map((attribute) => ({ attribute, itemCount: attrCount.get(attribute.id) ?? 0 })),
    units: [
      ...Object.values(BUILTIN_UNITS).map((unit) => ({ unit, custom: null, itemCount: unitCount.get(unit.key) ?? 0 })),
      ...[...s.units]
        .sort(byName)
        .map((custom) => {
          const key = customUnitKey(custom.id)
          return {
            unit: { key, name: custom.name, symbol: custom.symbol, prefixPowers: custom.prefixPowers },
            custom,
            itemCount: unitCount.get(key) ?? 0,
          }
        }),
    ],
  }
}
