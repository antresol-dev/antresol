<script setup lang="ts">
// "“X” already exists here": the live note under a name field whose name is already taken (spec 2026-11-17 §3). The
// form also disables Save; the core still refuses if a write gets through.
defineProps<{ id: string; taken: 'active' | 'archived' | 'name' | 'symbol' | null; name: string }>()
const keys = { active: 'nameTaken.active', archived: 'nameTaken.archived', name: 'nameTaken.unitName', symbol: 'nameTaken.unitSymbol' } as const
</script>

<template>
  <p v-if="taken" :id="id" role="status" class="field-text text-sm text-destructive">{{ $t(keys[taken], { name: name.trim() }) }}</p>
</template>
