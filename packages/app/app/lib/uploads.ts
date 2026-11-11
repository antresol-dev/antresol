import { deviceKeyValue, type KeyValue } from './diagnostics'

interface Uploads {
  /** Calendar month (UTC), 'YYYY-MM'. */
  month: string
  count: number
}

const monthOf = (date: Date): string => date.toISOString().slice(0, 7)
const keyOf = (sourceId: string): string => `uploads:${sourceId}`

/** How many photos this device uploaded for a source this month (the providers' free plans count uploads). A new month starts at zero. */
export function createUploadCounter(deps: { kv: KeyValue; now?: () => Date }) {
  const now = deps.now ?? (() => new Date())
  let chain: Promise<void> = Promise.resolve()
  return {
    count(sourceId: string): void {
      chain = chain
        .then(async () => {
          const month = monthOf(now())
          const kept = await deps.kv.get<Uploads>(keyOf(sourceId))
          await deps.kv.set(keyOf(sourceId), { month, count: (kept?.month === month ? kept.count : 0) + 1 })
        })
        .catch(() => {})
    },
    async thisMonth(sourceId: string): Promise<number> {
      await chain
      const kept = await deps.kv.get<Uploads>(keyOf(sourceId))
      return kept?.month === monthOf(now()) ? kept.count : 0
    },
  }
}

const counter = createUploadCounter({ kv: deviceKeyValue() })

/** Called by the upload path after a photo is stored. */
export const countUpload = (sourceId: string): void => counter.count(sourceId)
export const uploadsThisMonth = (sourceId: string): Promise<number> => counter.thisMonth(sourceId)
