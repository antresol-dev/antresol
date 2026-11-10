<script setup lang="ts">
import type { AttributeRow } from '~/lib/item-view'

defineProps<{ attributes: AttributeRow[] }>()
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('item.attributes') }}</h2>
    <dl class="rounded-card border border-border bg-surface py-1">
      <div
        v-for="a in attributes"
        :key="a.attributeId"
        class="relative flex min-h-11 items-baseline justify-between gap-4 px-3.5 py-2.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <dt class="min-w-0 text-[15px] text-muted-foreground wrap-anywhere">{{ a.name }}</dt>
        <dd v-if="a.perVariant" class="min-w-0 text-right text-[15px] text-muted-foreground wrap-anywhere">{{ $t('item.differsByVariant') }}</dd>
        <dd v-else-if="a.value === null" class="text-[15px] text-muted-foreground">{{ $t('item.noValue') }}</dd>
        <dd v-else class="min-w-0 text-right text-[15px] font-semibold wrap-anywhere">{{ a.value }}</dd>
      </div>
    </dl>
  </section>
</template>
