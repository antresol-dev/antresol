<script setup lang="ts">
const headingId = useId()
</script>

<template>
  <section :aria-labelledby="headingId" class="flex min-h-0 flex-col border-r border-border bg-surface">
    <div class="flex shrink-0 items-center px-4 pt-3.5 pb-1.5">
      <h2 :id="headingId" class="text-xs font-bold tracking-[0.02em] text-muted-foreground uppercase">
        {{ $t('folder.tree') }}
      </h2>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <FolderTree variant="panel" />
    </div>
  </section>
</template>
