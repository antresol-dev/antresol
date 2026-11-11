<script setup lang="ts">
import { shareParams } from '~/lib/share'

// The PWA share target (GET /share?title=…&text=…&url=…, relative to the base URL): opens the share sheet over the
// inventory's root and drops the parameters, so Back and a reload don't open it again.
definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
useShare().open(shareParams(route.query))
void router.replace({ path: '/' })
</script>

<template>
  <main class="min-w-0">
    <FolderScreen :folder-id="null" />
  </main>
</template>
