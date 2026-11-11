<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { defaultDeviceName } from '~/lib/device-name'
import { downloadBackup } from '~/lib/backup'
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
const sourceAction = 'h-11 rounded-field transition-colors duration-150 hover:bg-hover'

const exporting = ref<string | null>(null)

async function exportBackup(config: SourceConfig): Promise<void> {
  if (exporting.value) return
  exporting.value = config.id
  try {
    downloadBackup(await workspace.exportSource(config.id), new Date())
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  } finally {
    exporting.value = null
  }
}

const reloading = ref<string | null>(null)

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

const intervals: CheckInterval[] = ['5m', '15m', '1h', '6h', '1d', 'never']

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
        <h2 id="settings-sources" class="text-sm font-semibold text-subtle-foreground">{{ $t('settings.sources.title') }}</h2>
        <ul v-if="state.sources.length" class="divide-y divide-divider rounded-card border bg-surface">
          <li v-for="s in state.sources" :key="s.config.id" class="grid gap-1 px-4 py-2.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="min-w-0 break-words font-semibold">{{ s.config.name }}</span>
              <span v-if="kindLabel(s.config) !== s.config.name" class="text-sm text-subtle-foreground">{{ kindLabel(s.config) }}</span>
              <SourceStatusBadge :status="s.status" />
            </div>
            <p v-if="s.reason" class="break-words text-sm text-destructive">{{ $t(`errors.probe.${s.reason}`) }}</p>
            <div class="-mx-2 flex">
              <Button v-if="s.config.kind === 'neon'" as-child variant="ghost" :class="[sourceAction, 'text-primary']">
                <NuxtLink :to="`/settings/sources/${s.config.id}`">{{ $t('settings.sources.edit') }}</NuxtLink>
              </Button>
              <Button
                variant="ghost"
                :class="[sourceAction, 'text-primary']"
                :disabled="exporting !== null || (s.status !== 'ready' && s.status !== 'read_only')"
                @click="exportBackup(s.config)"
              >
                {{ exporting === s.config.id ? $t('settings.sources.exporting') : $t('settings.sources.exportBackup') }}
              </Button>
              <Button
                variant="ghost"
                :class="[sourceAction, 'text-primary']"
                :disabled="reloading !== null || (s.status !== 'ready' && s.status !== 'read_only')"
                @click="reload(s.config)"
              >
                {{ reloading === s.config.id ? $t('sync.reloading') : $t('sync.reload') }}
              </Button>
              <Button variant="ghost" :class="[sourceAction, 'text-destructive']" @click="removing = s.config">
                {{ $t('settings.sources.remove') }}
              </Button>
            </div>
            <p v-if="s.config.kind === 'neon'" class="text-sm text-subtle-foreground">{{ $t('settings.sources.exportHint') }}</p>
            <p class="text-sm text-subtle-foreground">{{ $t('sync.reloadHint') }}</p>
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
          <Label for="check-interval" class="mt-2">{{ $t('sync.interval') }}</Label>
          <Select :model-value="state.checkInterval" @update:model-value="changeInterval($event as CheckInterval)">
            <SelectTrigger id="check-interval" class="h-11 w-full rounded-field bg-surface">
              <SelectValue v-slot="{ modelValue }">{{ $t(`sync.${modelValue === 'never' ? 'never' : `every${modelValue}`}`) }}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="i in intervals" :key="i" :value="i">{{ $t(i === 'never' ? 'sync.never' : `sync.every${i}`) }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-sm text-subtle-foreground">{{ $t('sync.intervalHint') }}</p>
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
          <Button variant="outline" class="h-11 rounded-field bg-surface" @click="removing = null">{{ $t('ui.cancel') }}</Button>
          <Button
            variant="destructive"
            data-primary
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
