import { SI_PREFIXES, type UnitDef } from '@antresol/core'

/** A prefix as the unit form labels it: "Y · yotta (10^24)", "µ · micro (10^-6)". */
export function prefixNote(power: number): string {
  const p = SI_PREFIXES[power]
  return p ? `${p.symbol} · ${p.name} (10^${power})` : `10^${power}`
}

/** The prefixes of a unit in ascending power: "mm, cm, km". Pieces take a bare prefix: "k, M". */
export function prefixList(unit: UnitDef): string {
  return [...unit.prefixPowers]
    .sort((a, b) => a - b)
    .map((power) => {
      const symbol = SI_PREFIXES[power]?.symbol ?? ''
      return unit.key === 'pcs' ? symbol : `${symbol}${unit.symbol}`
    })
    .join(', ')
}
