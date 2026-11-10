<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { defaultDeviceName } from '~/lib/device-name'
import { errorMessageKey } from '~/lib/errors'
import type { SourceConfig } from '~/lib/types'

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

const removing = ref<SourceConfig | null>(null)
const sheetOpen = computed({
  get: () => removing.value !== null,
  set: (open) => {
    if (!open) removing.value = null
  },
})

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
        <h2 id="settings-sources" class="text-sm font-semibold text-subtle-foreground">{{ $t('settings.sources.title') }}</h2>
        <ul v-if="state.sources.length" class="divide-y divide-divider rounded-card border bg-surface">
          <li v-for="s in state.sources" :key="s.config.id" class="grid gap-1 px-4 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 break-words font-semibold">{{ s.config.name }}</span>
              <span class="text-sm text-subtle-foreground">{{ $t(`settings.sources.kind.${s.config.kind}`) }}</span>
              <SourceStatusBadge :status="s.status" />
            </div>
            <p v-if="s.reason" class="break-words text-sm text-destructive">{{ $t(`errors.probe.${s.reason}`) }}</p>
            <div class="-mx-2 flex">
              <Button v-if="s.config.kind === 'neon'" as-child variant="ghost" class="h-11 text-primary">
                <NuxtLink :to="`/settings/sources/${s.config.id}`">{{ $t('settings.sources.edit') }}</NuxtLink>
              </Button>
              <Button variant="ghost" class="h-11 text-destructive" @click="removing = s.config">
                {{ $t('settings.sources.remove') }}
              </Button>
            </div>
          </li>
        </ul>
        <p v-else class="text-subtle-foreground">{{ $t('settings.sources.empty') }}</p>
        <Button as-child variant="outline" class="h-11 rounded-field bg-surface">
          <NuxtLink to="/settings/sources/new">{{ $t('settings.sources.add') }}</NuxtLink>
        </Button>
      </section>

      <section class="grid gap-2" aria-labelledby="settings-device">
        <h2 id="settings-device" class="text-sm font-semibold text-subtle-foreground">{{ $t('settings.device.title') }}</h2>
        <div class="grid gap-1.5 rounded-card border bg-surface p-4">
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
        </div>
      </section>

      <section class="grid gap-2" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" class="text-sm font-semibold text-subtle-foreground">{{ $t('settings.appearance.title') }}</h2>
        <div class="rounded-card border bg-surface px-4 py-1">
          <ThemeSwitch />
        </div>
      </section>

      <AppSheet
        v-model:open="sheetOpen"
        :title="$t('settings.sources.removeTitle')"
        :description="$t('settings.sources.removeConfirm', { name: removing?.name ?? '' })"
      >
        <template #footer>
          <Button variant="outline" class="h-11 rounded-field" @click="removing = null">{{ $t('ui.cancel') }}</Button>
          <Button
            variant="destructive"
            class="h-11 rounded-field bg-destructive text-primary-foreground hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90"
            @click="confirmRemove"
          >
            {{ $t('settings.sources.remove') }}
          </Button>
        </template>
      </AppSheet>
    </ScreenBody>
  </main>
</template>
