import type { Ref } from 'vue'
import type { SharedConnection } from '~/lib/connection-share'

/** A source's settings received from another device (ReceiveSourceSheet), handed to the new-source page in memory:
 *  never in the address or the history. The page takes it once. */
export function useReceivedSource(): Ref<SharedConnection | null> {
  return useState<SharedConnection | null>('received-source', () => null)
}
