<script setup lang="ts">
import { CONNECT_PARAM, readConnection, type SharedConnection } from '~/lib/connection-share'

// A source's settings scanned from another device's QR code arrive in the fragment (#connect=…): they fill the form,
// and the fragment is dropped at once so the password does not stay in the address or the history entry.
const route = useRoute()
const router = useRouter()
const received = shallowRef<SharedConnection | null>(null)
const formKey = ref(0)
// Anyone can send such a link, so the form says plainly where it would connect: the database host and the photo store.
const host = computed(() => {
  try {
    return received.value ? new URL(received.value.connectionString).hostname : ''
  } catch {
    return ''
  }
})
watch(
  () => route.hash,
  (hash) => {
    if (!hash.includes(`${CONNECT_PARAM}=`)) return
    received.value = readConnection(hash)
    formKey.value++
    void router.replace({ path: route.path, query: route.query, hash: '' })
  },
  { immediate: true },
)
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('sourceForm.newTitle')" />
    <ScreenBody>
      <div v-if="received" role="status" class="grid gap-1 rounded-field bg-chip px-3 py-2.5 text-sm">
        <p>{{ $t('connectionScan.received') }}</p>
        <p class="font-semibold break-all">{{ $t('connectionScan.database', { host }) }}</p>
        <p class="font-semibold">{{ $t('connectionScan.photoStore', { store: $t(`sourceForm.store.${received.photoStore ?? 'uploadcare'}`) }) }}</p>
        <p class="text-subtle-foreground">{{ $t('connectionScan.trust') }}</p>
      </div>
      <SourceForm :key="formKey" :prefill="received ?? undefined" />
    </ScreenBody>
  </main>
</template>
