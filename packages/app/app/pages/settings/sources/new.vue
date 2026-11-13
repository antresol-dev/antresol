<script setup lang="ts">
import { CONNECT_PARAM, readConnection, type SharedConnection } from '~/lib/connection-share'

// A source's settings scanned from another device's QR code arrive in the fragment (#connect=…): they fill the form,
// and the fragment is dropped at once so the password does not stay in the address or the history entry.
const route = useRoute()
const router = useRouter()
const received = shallowRef<SharedConnection | null>(null)
const formKey = ref(0)
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
      <p v-if="received" role="status" class="rounded-field bg-chip px-3 py-2.5 text-sm">{{ $t('connectionScan.received') }}</p>
      <SourceForm :key="formKey" :prefill="received ?? undefined" />
    </ScreenBody>
  </main>
</template>
