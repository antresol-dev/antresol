<script setup lang="ts">
import { Search } from '@lucide/vue'

const model = defineModel<string>({ required: true })
</script>

<template>
  <label
    class="flex h-[46px] items-center gap-2.5 rounded-field border border-border bg-surface px-3.5 text-muted-foreground focus-within:border-primary"
  >
    <Search class="size-[18px] shrink-0" aria-hidden="true" />
    <span class="sr-only">{{ $t('search.label') }}</span>
    <input
      v-model="model"
      name="q"
      type="search"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      :placeholder="$t('search.placeholder')"
      class="min-w-0 grow appearance-none border-none bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
    >
  </label>
</template>
