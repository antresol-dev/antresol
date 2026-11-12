import { newId, type Id } from '@antresol/core'
import { reactive } from 'vue'

/**
 * Ids a form mints once, when it opens, and keeps until the command succeeds (or the form closes): a second "Save" after
 * a timeout then sends the same command, which the database skips (`on conflict do nothing`) instead of creating a twin.
 * Call `renew()` after a success and whenever the form is reopened for something new.
 */
export function useCommandIds<K extends string>(keys: readonly K[]): { ids: Readonly<Record<K, Id>>; renew: () => void } {
  const ids = reactive({} as Record<K, Id>) as Readonly<Record<K, Id>>
  const renew = (): void => {
    for (const key of keys) (ids as Record<string, Id>)[key] = newId()
  }
  renew()
  return { ids, renew }
}
