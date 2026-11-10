<script setup lang="ts">
defineProps<{ text: string }>()
</script>

<template>
  <div class="grid justify-items-center gap-2 px-4 py-10 text-center text-subtle-foreground">
    <p class="text-[15px] font-semibold wrap-anywhere">{{ text }}</p>
    <slot />
  </div>
</template>
