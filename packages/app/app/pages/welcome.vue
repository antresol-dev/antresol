<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ScanQrCode } from '@lucide/vue'
import { canScanConnection } from '~/lib/connection-share'
import { errorMessageKey } from '~/lib/errors'

definePageMeta({ layout: 'bare' })

const { t } = useI18n()
const workspace = useWorkspace()
const router = useRouter()
const busy = ref(false)
const isDev = import.meta.dev
// A source set up on another device comes over by its QR code (Settings → Share there).
const canScan = canScanConnection()
const scanOpen = ref(false)

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
  <main class="mx-auto grid min-h-dvh max-w-md content-center justify-items-start gap-3.5 px-4 py-2.5">
    <AppLogo class="size-14" />
    <p class="sr-only">{{ $t('app.name') }}</p>
    <h1 class="text-2xl font-bold tracking-[-0.02em]">{{ $t('welcome.title') }}</h1>
    <p class="text-subtle-foreground">{{ $t('welcome.body') }}</p>
    <div class="grid w-full gap-2">
      <Button as-child class="h-11 rounded-field">
        <NuxtLink to="/settings/sources/new">{{ $t('welcome.addSource') }}</NuxtLink>
      </Button>
      <Button v-if="canScan" variant="outline" class="h-11" @click="scanOpen = true">
        <ScanQrCode class="size-5" aria-hidden="true" />
        {{ $t('connectionScan.open') }}
      </Button>
      <Button v-if="isDev" variant="outline" class="h-11" :disabled="busy" @click="useDemo">
        {{ $t('welcome.useDemo') }}
      </Button>
    </div>
    <ConnectionScanSheet v-if="canScan" v-model:open="scanOpen" />
  </main>
</template>
