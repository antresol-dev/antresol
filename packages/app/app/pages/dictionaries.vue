<script setup lang="ts">
import { dictionaryView } from '~/lib/dictionaries'

definePageMeta({ layout: 'default' })

const { state } = useWorkspace()

/** The current inventory's snapshot only: never another inventory's paired with the current ref. */
const view = computed(() => {
  const s = state.snapshot
  return s && s.inventory.id === state.current?.inventoryId ? dictionaryView(s) : null
})
</script>

<template>
  <main class="min-w-0">
    <ScreenHeader :title="$t('dictionaries.title')" />
    <ScreenBody>
      <template v-if="view">
        <TagsSection :rows="view.tags" />
        <AttributesSection :rows="view.attributes" />
        <UnitsSection :rows="view.units" />
      </template>
      <div v-else class="grid grid-cols-1 gap-3.5" aria-hidden="true">
        <Skeleton class="h-40 rounded-card" />
      </div>
    </ScreenBody>
  </main>
</template>
