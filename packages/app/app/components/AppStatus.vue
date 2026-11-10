<script setup lang="ts">
import { Button } from '@/components/ui/button'

const { t, locale } = useI18n()
const workspace = useWorkspace()
const { state } = workspace

const currentSource = computed(() => state.sources.find((s) => s.config.id === state.current?.sourceId) ?? null)
const savedTime = computed(() =>
  state.snapshotSavedAt
    ? new Date(state.snapshotSavedAt).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '',
)

const line = computed<{ text: string; fixTo?: string; retry?: boolean } | null>(() => {
  if (state.readOnly === 'offline') {
    return {
      text: savedTime.value ? t('status.offline', { time: savedTime.value }) : t('status.offlineNoCopy'),
      retry: true,
    }
  }
  if (state.readOnly === 'schema_newer') return { text: t('status.schemaNewer') }
  if (state.readOnly === 'source_error') {
    const source = currentSource.value
    return {
      text: t('status.sourceError', { source: source?.config.name ?? '', reason: t(`errors.probe.${source?.reason ?? 'failed'}`) }),
      fixTo: source?.config.kind === 'neon' ? `/settings/sources/${source.config.id}` : '/settings',
      retry: true,
    }
  }
  if (!state.persistent) return { text: t('status.notPersistent') }
  if (state.snapshotOrigin === 'cache' && state.refreshing) return { text: t('status.updating') }
  return null
})

function retry(): void {
  void workspace.refresh().catch(() => {})
}
</script>

<template>
  <p v-if="line" role="status" class="text-sm text-subtle-foreground">
    {{ line.text }}
    <NuxtLink v-if="line.fixTo" :to="line.fixTo" class="font-semibold text-primary underline-offset-4 hover:underline">
      {{ $t('status.fix') }}
    </NuxtLink>
    <Button
      v-if="line.retry"
      variant="ghost"
      class="h-11 px-2 font-semibold text-primary"
      :disabled="state.refreshing"
      @click="retry"
    >
      {{ $t('status.retry') }}
    </Button>
  </p>
</template>
