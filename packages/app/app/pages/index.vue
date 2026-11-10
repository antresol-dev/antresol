<script setup lang="ts">
const { state } = useWorkspace()
const name = computed(() => {
  const cur = state.current
  const entry = cur && state.inventories.find((e) => e.ref.sourceId === cur.sourceId && e.ref.inventoryId === cur.inventoryId)
  return entry?.inventory.name ?? state.snapshot?.inventory.name ?? null
})
</script>

<template>
  <main class="grid gap-3.5 px-4 py-2.5">
    <h1 class="text-2xl font-bold tracking-[-0.02em]">{{ name ?? $t('app.name') }}</h1>
    <AppStatus />
  </main>
</template>
