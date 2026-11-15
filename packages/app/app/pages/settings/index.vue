<script setup lang="ts">
import { ScanQrCode } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { canPair } from '~/lib/connection-share'
import { defaultDeviceName } from '~/lib/device-name'
import { errorMessageKey } from '~/lib/errors'
import type { SourceConfig } from '~/lib/types'
import type { CheckInterval } from '~/lib/workspace-types'

const { t } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const placeholder = defaultDeviceName(navigator.userAgent)
const deviceName = ref(state.deviceName === placeholder ? '' : state.deviceName)

async function saveDeviceName(): Promise<void> {
  try {
    await workspace.setDeviceName(deviceName.value)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}

// The source type is shown only when it says something the name does not (a demo source is named "Demo").
const kindLabel = (c: SourceConfig): string => t(`settings.sources.kind.${c.kind}`)

const removing = ref<SourceConfig | null>(null)
const sheetOpen = computed({
  get: () => removing.value !== null,
  set: (open) => {
    if (!open) removing.value = null
  },
})

// Neutral hover; the text keeps its colour.
const sourceAction = 'h-11'

const reloading = ref<string | null>(null)

// Moving a source to another device: a QR code here, the camera there.
const sharing = ref<SourceConfig | null>(null)
const shareOpen = computed({
  get: () => sharing.value !== null,
  set: (open) => {
    if (!open) sharing.value = null
  },
})
const connectingAi = ref<SourceConfig | null>(null)
const connectAiOpen = computed({
  get: () => connectingAi.value !== null,
  set: (open) => {
    if (!open) connectingAi.value = null
  },
})
const receiveOpen = ref(false)
const canReceive = canPair()

async function reload(config: SourceConfig): Promise<void> {
  if (reloading.value) return
  reloading.value = config.id
  try {
    await workspace.reloadSource(config.id)
    toast(t('sync.reloaded'))
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    reloading.value = null
  }
}

async function changeInterval(value: CheckInterval): Promise<void> {
  try {
    await workspace.setCheckInterval(value)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}

async function confirmRemove(): Promise<void> {
  const target = removing.value
  removing.value = null
  if (!target) return
  try {
    await workspace.removeSource(target.id)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('settings.title')" />
    <ScreenBody>
      <section class="grid gap-2" aria-labelledby="settings-sources">
        <h2 id="settings-sources" class="section-label text-sm">{{ $t('settings.sources.title') }}</h2>
        <ul v-if="state.sources.length" class="raised-card divide-y divide-divider">
          <li v-for="s in state.sources" :key="s.config.id" class="grid gap-1 px-4.5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 break-words font-semibold">{{ s.config.name }}</span>
              <span v-if="kindLabel(s.config) !== s.config.name" class="text-sm text-subtle-foreground">{{ kindLabel(s.config) }}</span>
              <SourceStatusBadge :status="s.status" />
            </div>
            <p v-if="s.reason" class="break-words text-sm text-destructive">{{ $t(`errors.probe.${s.reason}`) }}</p>
            <div class="-mx-2 flex">
              <Button v-if="s.config.kind === 'neon'" as-child variant="ghost" :class="[sourceAction, 'text-accent-ink']">
                <NuxtLink :to="`/settings/sources/${s.config.id}`">{{ $t('settings.sources.edit') }}</NuxtLink>
              </Button>
              <Button
                variant="ghost"
                :class="[sourceAction, 'text-accent-ink']"
                :disabled="reloading !== null || (s.status !== 'ready' && s.status !== 'read_only')"
                @click="reload(s.config)"
              >
                {{ reloading === s.config.id ? $t('sync.reloading') : $t('sync.reload') }}
              </Button>
              <Button v-if="s.config.kind === 'neon'" variant="ghost" :class="[sourceAction, 'text-accent-ink']" @click="sharing = s.config">
                {{ $t('settings.sources.share') }}
              </Button>
              <Button v-if="s.config.kind === 'neon'" variant="ghost" :class="[sourceAction, 'text-accent-ink']" @click="connectingAi = s.config">
                {{ $t('settings.sources.connectAi') }}
              </Button>
              <Button variant="ghost" :class="[sourceAction, 'text-destructive']" @click="removing = s.config">
                {{ $t('settings.sources.remove') }}
              </Button>
            </div>
            <p class="text-sm text-subtle-foreground">{{ $t('sync.reloadHint') }}</p>
            <SourceTraffic v-if="s.config.kind === 'neon'" :source-id="s.config.id" />
            <SourceUploads :source-id="s.config.id" />
            <SourceBackup :source="s" />
          </li>
        </ul>
        <p v-else class="text-subtle-foreground">{{ $t('settings.sources.empty') }}</p>
        <Button as-child variant="outline" class="h-11">
          <NuxtLink to="/settings/sources/new">{{ $t('settings.sources.add') }}</NuxtLink>
        </Button>
        <Button v-if="canReceive" variant="outline" class="h-11" @click="receiveOpen = true">
          <ScanQrCode class="size-5" aria-hidden="true" />
          {{ $t('pairing.receive') }}
        </Button>
        <ConnectionShareSheet v-model:open="shareOpen" :source="sharing" />
        <ConnectAiSheet v-model:open="connectAiOpen" :source="connectingAi" />
        <ReceiveSourceSheet v-if="canReceive" v-model:open="receiveOpen" />
      </section>

      <section class="grid gap-2" aria-labelledby="settings-device">
        <h2 id="settings-device" class="section-label text-sm">{{ $t('settings.device.title') }}</h2>
        <div class="raised-card grid gap-1.5 p-4.5">
          <Label for="device-name">{{ $t('settings.device.name') }}</Label>
          <Input
            id="device-name"
            v-model="deviceName"
            :placeholder="placeholder"
            autocomplete="off"
            class="h-11 rounded-field"
            @blur="saveDeviceName"
          />
          <p class="text-sm text-subtle-foreground">{{ $t('settings.device.hint') }}</p>
          <Label for="check-interval" class="mt-2">{{ $t('sync.interval') }}</Label>
          <IntervalSlider id="check-interval" :model-value="state.checkInterval" @update:model-value="changeInterval" />
          <p class="text-sm text-subtle-foreground">{{ $t('sync.intervalHint') }}</p>
        </div>
      </section>

      <section class="grid gap-2" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" class="section-label text-sm">{{ $t('settings.appearance.title') }}</h2>
        <div class="raised-card grid gap-2 px-4.5 pt-2 pb-4.5">
          <ThemeSwitch />
          <div class="h-px bg-divider" aria-hidden="true" />
          <StylePicker class="pt-2" />
          <div class="h-px bg-divider" aria-hidden="true" />
          <AccentPicker class="pt-2" />
        </div>
      </section>

      <PhotoCacheSection />

      <DiagnosticsSection />

      <AppSheet
        v-model:open="sheetOpen"
        :title="$t('settings.sources.removeTitle')"
        :description="$t('settings.sources.removeConfirm', { name: removing?.name ?? '' })"
      >
        <template #footer>
          <Button variant="outline" class="h-11" @click="removing = null">{{ $t('ui.cancel') }}</Button>
          <Button
            variant="destructive"
            data-primary
            class="h-11"
            @click="confirmRemove"
          >
            {{ $t('settings.sources.remove') }}
          </Button>
        </template>
      </AppSheet>
    </ScreenBody>
  </main>
</template>
