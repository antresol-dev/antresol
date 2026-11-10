<script setup lang="ts">
const { t, locale } = useI18n()
const { state } = useWorkspace()

const currentSource = computed(() => state.sources.find((s) => s.config.id === state.current?.sourceId) ?? null)
const savedTime = computed(() =>
  state.snapshotSavedAt
    ? new Date(state.snapshotSavedAt).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
    : '',
)

const line = computed<{ text: string; fixTo?: string } | null>(() => {
  if (state.readOnly === 'offline') return { text: t('status.offline', { time: savedTime.value }) }
  if (state.readOnly === 'schema_newer') return { text: t('status.schemaNewer') }
  if (state.readOnly === 'source_error') {
    const source = currentSource.value
    return {
      text: t('status.sourceError', { source: source?.config.name ?? '', reason: source?.error ?? '' }),
      fixTo: source?.config.kind === 'neon' ? `/settings/sources/${source.config.id}` : '/settings',
    }
  }
  if (!state.persistent) return { text: t('status.notPersistent') }
  if (state.snapshotOrigin === 'cache' && state.refreshing) return { text: t('status.updating') }
  return null
})
</script>

<template>
  <p v-if="line" role="status" class="text-sm text-subtle-foreground">
    {{ line.text }}
    <NuxtLink v-if="line.fixTo" :to="line.fixTo" class="font-semibold text-primary underline-offset-4 hover:underline">
      {{ $t('status.fix') }}
    </NuxtLink>
  </p>
</template>
