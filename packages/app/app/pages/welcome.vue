<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ScanQrCode } from '@lucide/vue'
import { canPair } from '~/lib/connection-share'
import { errorMessageKey } from '~/lib/errors'

definePageMeta({ layout: 'bare' })

const { t } = useI18n()
const workspace = useWorkspace()
const router = useRouter()
const busy = ref(false)
const isDev = import.meta.dev
// A source set up on another device comes over by its QR code (Settings → Share there).
const canReceive = canPair()
const receiveOpen = ref(false)

async function useDemo(): Promise<void> {
  busy.value = true
  try {
    await workspace.addSource({ kind: 'dev-pglite', name: 'Demo', connectionString: '', uploadcarePublicKey: null })
    await router.push('/')
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="mx-auto grid min-h-dvh max-w-md content-center justify-items-start gap-4 px-4 py-4">
    <AppLogo class="size-14" />
    <p class="sr-only">{{ $t('app.name') }}</p>
    <h1 class="text-2xl font-semibold tracking-[-0.02em]">{{ $t('welcome.title') }}</h1>
    <p class="text-subtle-foreground">{{ $t('welcome.body') }}</p>
    <div class="grid w-full gap-2">
      <Button as-child class="h-11 rounded-field">
        <NuxtLink to="/settings/sources/new">{{ $t('welcome.addSource') }}</NuxtLink>
      </Button>
      <Button v-if="canReceive" variant="outline" class="h-11" @click="receiveOpen = true">
        <ScanQrCode class="size-5" aria-hidden="true" />
        {{ $t('pairing.receive') }}
      </Button>
      <Button v-if="isDev" variant="outline" class="h-11" :disabled="busy" @click="useDemo">
        {{ $t('welcome.useDemo') }}
      </Button>
    </div>
    <ReceiveSourceSheet v-if="canReceive" v-model:open="receiveOpen" />
  </main>
</template>
