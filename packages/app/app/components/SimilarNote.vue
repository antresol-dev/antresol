<script setup lang="ts">
import type { SimilarName } from '@antresol/kit/similar-names'

// "Looks similar: …": advice under a name field, never a refusal (spec 2026-11-17 §5). A name of another folder says
// where it is. Nothing is shown when nothing looks similar.
const props = defineProps<{ names: readonly SimilarName[] }>()
const { t } = useI18n()
const text = computed(() => t('intakes.similar.note', { names: props.names.map((n) => (n.where ? t('intakes.similar.where', { name: n.name, where: n.where }) : n.name)).join(', ') }))
</script>

<template>
  <p v-if="names.length > 0" role="status" class="field-text text-sm text-muted-foreground">{{ text }}</p>
</template>
