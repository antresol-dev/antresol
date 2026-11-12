import type { Ref } from 'vue'
import { navAvailability } from '~/lib/history-nav'

/** In-app back and forward; each button knows from history.state whether there is anywhere to go. */
export function useNavHistory(): { canBack: Ref<boolean>; canForward: Ref<boolean>; back(): void; forward(): void } {
  const router = useRouter()
  const canBack = ref(false)
  const canForward = ref(false)

  function read(): void {
    const { canBack: b, canForward: f } = navAvailability(window.history.state)
    canBack.value = b
    canForward.value = f
  }

  onMounted(read)
  onScopeDispose(router.afterEach(() => read()))

  return {
    canBack,
    canForward,
    back: () => router.back(),
    forward: () => router.forward(),
  }
}
