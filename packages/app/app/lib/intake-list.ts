import type { Id, Intake, IntakeHeader, IntakeStatus, InventorySnapshot } from '@antresol/core'
import type { LocalIntakeDraft } from './intake-drafts'
import type { ReadOnlyReason } from './workspace-types'

export interface IntakeRow {
  id: Id
  status: IntakeStatus
  /** "LCSC · #WM2511-0042", "LCSC", "#WM2511-0042", or "Intake · 12 Nov" when the header names neither. */
  title: string
  /** The purchase day as written on the row: "12 Nov 2026". */
  date: string
  lineCount: number
  /** Who started the intake (spec §3). */
  by: string
}

/** A YYYY-MM-DD day as a local calendar date (never through UTC, which can shift the day). */
function localDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })
const fullDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDay(day: string, withYear = true): string {
  const date = localDate(day)
  return date ? (withYear ? fullDay : shortDay).format(date) : day
}

const clean = (text: string | null): string | null => text?.trim() || null

export function intakeTitle(h: IntakeHeader): string {
  const shop = clean(h.shop)
  const order = clean(h.orderNumber)
  if (shop && order) return `${shop} · #${order}`
  if (shop) return shop
  if (order) return `#${order}`
  return `Intake · ${formatDay(h.purchasedOn, false)}`
}

const lineCountOf = (i: Intake): number => (i.status === 'draft' ? (i.draft?.lines.length ?? 0) : (i.lines?.length ?? 0))

/** Drafts first (newest purchase first), then committed ones by purchase day and commit time, newest first. */
export function intakeRows(intakes: Intake[], _s: InventorySnapshot): IntakeRow[] {
  const rank = (i: Intake): number => (i.status === 'draft' ? 0 : 1)
  const newest = (a: string | null, b: string | null): number => (b ?? '').localeCompare(a ?? '')
  return [...intakes]
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        newest(a.header.purchasedOn, b.header.purchasedOn) ||
        newest(a.committedAt ?? a.updatedAt, b.committedAt ?? b.updatedAt),
    )
    .map((i) => ({
      id: i.id,
      status: i.status,
      title: intakeTitle(i.header),
      date: formatDay(i.header.purchasedOn),
      lineCount: lineCountOf(i),
      by: i.createdBy,
    }))
}

/** Everything a search can match in an intake, lower-cased: shop, order number, and the item names of its lines (a
 *  committed line: the name it was committed under and the item's current name; a draft: its new items and the current
 *  names of the existing items it receives). */
function haystack(i: Intake, s: InventorySnapshot): string {
  const names = new Map(s.items.map((item) => [item.id, item.name]))
  const parts: (string | null | undefined)[] = [i.header.shop, i.header.orderNumber]
  if (i.status === 'committed') {
    for (const l of i.lines ?? []) parts.push(l.itemName, names.get(l.itemId))
  } else if (i.draft) {
    const created = new Map(i.draft.newItems.map((n) => [n.id, n.name]))
    for (const l of i.draft.lines) parts.push(created.get(l.itemId) ?? names.get(l.itemId))
  }
  return parts.filter((p): p is string => !!p).join('\n').toLowerCase()
}

/** Every word of the query has to be found, case does not matter; an empty query keeps all. */
export function searchIntakes(intakes: Intake[], s: InventorySnapshot, query: string): Intake[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return intakes
  return intakes.filter((i) => {
    const text = haystack(i, s)
    return words.every((w) => text.includes(w))
  })
}

/** A device copy as a draft row; `by`: who started it, when known. */
const copyRow = (id: Id, d: LocalIntakeDraft, inventoryId: Id, by: string): Intake => ({
  id,
  inventoryId,
  status: 'draft',
  header: d.header,
  draft: d.content,
  lines: null,
  draftRev: d.baseDraftRev ?? '',
  createdAt: '',
  createdBy: by,
  updatedAt: '',
  updatedBy: by,
  committedAt: null,
})

/**
 * The database's intakes with this device's drafts of the inventory: a draft only this device has (never saved, or
 * with edits whose row is gone) comes first, by `device`; a draft row this device has unsaved edits of shows them. A
 * committed row stays as it is, and so does a clean copy (what the database said last).
 */
export function withDeviceDrafts(
  rows: Intake[],
  copies: { id: Id; draft: LocalIntakeDraft }[],
  inventoryId: Id,
  device: string,
): Intake[] {
  const mine = new Map(copies.filter((c) => c.draft.inventoryId === inventoryId).map((c) => [c.id, c.draft] as const))
  const known = new Set(rows.map((r) => r.id))
  const onlyHere: Intake[] = [...mine]
    .filter(([id, d]) => !known.has(id) && (d.baseDraftRev === null || d.dirty))
    .map(([id, d]) => copyRow(id, d, inventoryId, device))
  const merged = rows.map((r) => {
    const d = mine.get(r.id)
    return d?.dirty && r.status === 'draft' ? { ...r, header: d.header, draft: d.content } : r
  })
  return [...onlyHere, ...merged]
}

/** Offline, while the database's list cannot be read (spec §4: drafts are edited on the device without a network):
 *  every draft this device holds a copy of, of the inventory, as the device last saw it; not one marked committed on
 *  another device. Who started a draft is known here only for one not in the database yet (this device). */
export function deviceIntakes(copies: { id: Id; draft: LocalIntakeDraft }[], inventoryId: Id, device: string): Intake[] {
  return copies
    .filter(({ draft: d }) => d.inventoryId === inventoryId && d.changedElsewhere?.status !== 'committed')
    .map(({ id, draft: d }) => copyRow(id, d, inventoryId, d.baseDraftRev === null ? device : ''))
}

/** "New intake": a new draft lives on the device until it is sent, so offline too; not while the source needs a newer
 *  app (nothing may be written) or fails. */
export function canCreateIntake(readOnly: ReadOnlyReason | null): boolean {
  return readOnly === null || readOnly === 'offline'
}
