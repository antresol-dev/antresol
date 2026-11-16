<script setup lang="ts">
import { Button } from '@/components/ui/button'

const route = useRoute()
const { state } = useWorkspace()
const source = computed(() => state.sources.find((s) => s.config.id === route.params.id)?.config)
</script>

<template>
  <main v-if="source" class="min-w-0">
    <ScreenHeader :title="source.name" :subtitle="$t('sourceForm.editTitle')" :crumbs="[{ name: $t('settings.title'), to: '/settings' }]" />
    <ScreenBody>
      <SourceForm :key="source.id" :source="source" />
    </ScreenBody>
  </main>
  <main v-else class="min-w-0">
    <ScreenHeader :title="$t('settings.title')" />
    <ScreenBody>
      <EmptyState :text="$t('empty.sourceGone')">
        <Button as-child variant="outline" class="h-11">
          <NuxtLink to="/settings">{{ $t('empty.backToSettings') }}</NuxtLink>
        </Button>
      </EmptyState>
    </ScreenBody>
  </main>
</template>
