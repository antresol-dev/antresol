/** The tone (0..count-1) of an item's thumbnail: FNV-1a 32-bit over its id, so it never changes with a rename or a move. */
export function thumbTone(id: string, count: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % count
}
