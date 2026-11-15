import type { Id, Intake, Inventory, InventorySnapshot, InventoryStorage } from '@antresol/core'

/** What the read tools see of the database: a cached copy that is checked against the source revision. */
export interface Source {
  inventories(): Promise<Inventory[]>
  snapshot(inventoryId: Id): Promise<InventorySnapshot>
  intakes(inventoryId: Id): Promise<Intake[]>
  /** Forget everything: the next read goes to the database. Called after a write. */
  refresh(): void
  readonly readOnly: boolean
}

export interface SourceOptions {
  now?: () => number
  /** Within this window a cached copy is returned without asking the database anything. Default 3000. */
  revCheckMs?: number
}

interface Checked<T> {
  value: T
  rev: string
  checkedAt: number
}

/**
 * Cache over an InventoryStorage. Past the window, only the revision is read (`listInventories().rev`; `intakesRev()` for
 * intakes, which drafts change without touching `rev`); the data is read again only when it changed.
 */
export function createSource(storage: InventoryStorage, options: SourceOptions = {}): Source {
  const now = options.now ?? Date.now
  const windowMs = options.revCheckMs ?? 3000
  let generation = 0
  let list: Checked<Inventory[]> | null = null
  let snapshots = new Map<Id, Checked<InventorySnapshot>>()
  let intakeLists = new Map<Id, Checked<Intake[]>>()
  let pending = new Map<string, Promise<unknown>>()

  const fresh = (c: { checkedAt: number } | null | undefined): boolean => !!c && now() - c.checkedAt < windowMs

  /** One request at a time per key: concurrent calls share it. */
  function once<T>(key: string, run: () => Promise<T>): Promise<T> {
    const running = pending.get(key) as Promise<T> | undefined
    if (running) return running
    const task = run().finally(() => {
      if (pending.get(key) === task) pending.delete(key)
    })
    pending.set(key, task)
    return task
  }

  /** The inventory list, read when the window has passed. `rev` is what cached snapshots are compared to. */
  async function currentList(): Promise<Checked<Inventory[]>> {
    if (list && fresh(list)) return list
    return once('list', async () => {
      const gen = generation
      const read = await storage.listInventories()
      const entry = { value: read.inventories, rev: read.rev, checkedAt: now() }
      if (gen === generation) list = entry
      return entry
    })
  }

  return {
    readOnly: storage.readOnly,
    async inventories() {
      return (await currentList()).value
    },
    async snapshot(inventoryId) {
      const cached = snapshots.get(inventoryId)
      if (cached && fresh(cached)) return cached.value
      const { rev } = await currentList()
      const held = snapshots.get(inventoryId)
      if (held && held.rev === rev) {
        held.checkedAt = now()
        return held.value
      }
      return once(`snapshot:${inventoryId}`, async () => {
        const gen = generation
        const read = await storage.loadInventoryWithRev(inventoryId)
        const entry = { value: read.snapshot, rev: read.rev, checkedAt: now() }
        if (gen === generation) snapshots.set(inventoryId, entry)
        return entry.value
      })
    },
    async intakes(inventoryId) {
      const cached = intakeLists.get(inventoryId)
      if (cached && fresh(cached)) return cached.value
      return once(`intakes:${inventoryId}`, async () => {
        const gen = generation
        const held = intakeLists.get(inventoryId)
        if (held && held.rev === (await storage.intakesRev())) {
          held.checkedAt = now()
          return held.value
        }
        const read = await storage.listIntakes(inventoryId)
        const entry = { value: read.intakes, rev: read.intakesRev, checkedAt: now() }
        if (gen === generation) intakeLists.set(inventoryId, entry)
        return entry.value
      })
    },
    refresh() {
      generation++
      list = null
      snapshots = new Map()
      intakeLists = new Map()
      pending = new Map()
    },
  }
}
