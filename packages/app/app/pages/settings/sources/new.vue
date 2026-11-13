<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { endPairing, openConnection, PAIR_PARAM, pairToken, pendingPairing, type SharedConnection } from '~/lib/connection-share'

// A source's settings from another device (lib/connection-share.ts) fill the form, to check and save here:
// - from the in-app scanner (ReceiveSourceSheet), in memory;
// - from the phone's camera app, as #pair=<token> in the address, opened with the code this device is waiting with.
//   The fragment is dropped at once so the sealed settings don't stay in the address or the history entry.
const route = useRoute()
const router = useRouter()
const handed = useReceivedSource()
const received = shallowRef<SharedConnection | null>(null)
const formKey = ref(0)
const linkProblem = ref<'noCode' | 'mismatch' | null>(null)
const opening = ref(false)
const receiveOpen = ref(false)

function fill(c: SharedConnection): void {
  received.value = c
  linkProblem.value = null
  formKey.value++
}

watch(
  handed,
  (c) => {
    if (!c) return
    handed.value = null
    fill(c)
  },
  { immediate: true },
)

watch(
  () => route.hash,
  async (hash) => {
    if (!hash.includes(`${PAIR_PARAM}=`)) return
    const token = pairToken(hash)
    void router.replace({ path: route.path, query: route.query, hash: '' })
    if (!token) return
    let storage: Storage | null = null
    try {
      storage = localStorage
    } catch {
      // No storage: no code can be waiting.
    }
    const pending = pendingPairing(storage, Date.now())
    if (!pending) {
      linkProblem.value = 'noCode'
      return
    }
    opening.value = true
    try {
      const found = await openConnection(token, pending.code)
      if (!found) {
        linkProblem.value = 'mismatch'
        return
      }
      endPairing(storage)
      fill(found)
    } finally {
      opening.value = false
    }
  },
  { immediate: true },
)

const host = computed(() => {
  try {
    return received.value ? new URL(received.value.connectionString).hostname : ''
  } catch {
    return ''
  }
})
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('sourceForm.newTitle')" />
    <ScreenBody>
      <p v-if="opening" role="status" class="text-sm">{{ $t('pairing.opening') }}</p>
      <div v-else-if="linkProblem" role="alert" class="grid gap-2 rounded-field bg-chip px-3 py-2.5 text-sm">
        <p>{{ $t(`pairing.link.${linkProblem}`) }}</p>
        <Button type="button" variant="outline" class="h-11" @click="receiveOpen = true">{{ $t('pairing.receive') }}</Button>
      </div>
      <div v-if="received" role="status" class="grid gap-1 rounded-field bg-chip px-3 py-2.5 text-sm">
        <p>{{ $t('pairing.received') }}</p>
        <p class="font-semibold break-all">{{ $t('pairing.database', { host }) }}</p>
        <p class="font-semibold">{{ $t('pairing.photoStore', { store: $t(`sourceForm.store.${received.photoStore ?? 'uploadcare'}`) }) }}</p>
      </div>
      <SourceForm :key="formKey" :prefill="received ?? undefined" />
      <ReceiveSourceSheet v-model:open="receiveOpen" />
    </ScreenBody>
  </main>
</template>
