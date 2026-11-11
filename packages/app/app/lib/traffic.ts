import { deviceKeyValue, type KeyValue } from './diagnostics'

/** Neon's free plan: data transfer per month. */
export const MONTHLY_LIMIT_BYTES = 5 * 1024 ** 3

export interface Traffic {
  /** Calendar month (UTC), 'YYYY-MM'. */
  month: string
  bytes: number
}

const monthOf = (date: Date): string => date.toISOString().slice(0, 7)
const keyOf = (sourceId: string): string => `traffic:${sourceId}`

/** An estimate of what a source's responses weighed this month on this device. A new month starts at zero. */
export function createTrafficMeter(deps: { kv: KeyValue; now?: () => Date }) {
  const now = deps.now ?? (() => new Date())
  let chain: Promise<void> = Promise.resolve()
  return {
    add(sourceId: string, bytes: number): void {
      if (!(bytes > 0)) return
      chain = chain
        .then(async () => {
          const month = monthOf(now())
          const kept = await deps.kv.get<Traffic>(keyOf(sourceId))
          const base = kept?.month === month ? kept.bytes : 0
          await deps.kv.set(keyOf(sourceId), { month, bytes: base + bytes })
        })
        .catch(() => {})
    },
    async monthly(sourceId: string): Promise<Traffic> {
      await chain
      const month = monthOf(now())
      const kept = await deps.kv.get<Traffic>(keyOf(sourceId))
      return kept?.month === month ? kept : { month, bytes: 0 }
    },
  }
}

export const trafficMeter = createTrafficMeter({ kv: deviceKeyValue() })

/** "120 MB", "1.4 GB": whole megabytes, a decimal for gigabytes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}
