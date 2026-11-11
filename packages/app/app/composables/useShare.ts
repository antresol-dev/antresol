import type { Id } from '@graymatter/core'
import type { Ref } from 'vue'
import type { ShareInput } from '~/lib/share'

/** The share sheet for the whole app (spec 4.10): the /share route (PWA share target) and a link pasted into the palette
 *  open it with what was shared. */
export function useShare(): { shared: Ref<ShareInput | null>; open(input: ShareInput): void; close(): void } {
  const shared = useState<ShareInput | null>('share', () => null)
  return {
    shared,
    open: (input) => {
      shared.value = { ...input }
    },
    close: () => {
      shared.value = null
    },
  }
}

/** Receiving into an item from outside its card: "Receive here" in quick add, "Receive…" in the share sheet. The
 *  amount, price and link typed there carry over. */
export interface ReceiveRequest {
  itemId: Id
  variantId: Id | null
  amount?: string
  price?: string
  url?: string
}

export function useReceive(): { request: Ref<ReceiveRequest | null>; open(r: ReceiveRequest): void; close(): void } {
  const request = useState<ReceiveRequest | null>('receive', () => null)
  return {
    request,
    open: (r) => {
      request.value = { ...r }
    },
    close: () => {
      request.value = null
    },
  }
}
