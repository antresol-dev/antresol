<script setup lang="ts">
import { Cpu } from '@lucide/vue'
import type { ItemRow } from '~/lib/views'

const props = defineProps<{ items: ItemRow[] }>()
const { t } = useI18n()

const rows = computed(() =>
  props.items.map((item) => ({
    ...item,
    sub: [
      item.outOfStock ? t('item.outOfStock') : null,
      item.description,
      item.variantCount > 0 ? t('item.variants', item.variantCount) : null,
    ]
      .filter((x): x is string => !!x)
      .join(' · '),
  })),
)
</script>

<template>
  <section class="grid gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('folder.items', { count: items.length }) }}</h2>
    <ul class="overflow-hidden rounded-card border border-border bg-surface py-1">
      <li
        v-for="item in rows"
        :key="item.id"
        class="relative not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-[68px] not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <NuxtLink
          :to="`/item/${item.id}`"
          class="flex h-[62px] items-center gap-3 px-3.5 outline-none transition-colors duration-150 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span class="flex size-[42px] shrink-0 items-center justify-center overflow-hidden rounded-thumb bg-thumb text-thumb-foreground">
            <img v-if="item.coverUrl" :src="item.coverUrl" alt="" loading="lazy" class="size-full object-cover" >
            <Cpu v-else class="size-5" stroke-width="1.75" aria-hidden="true" />
          </span>
          <span class="flex min-w-0 grow flex-col gap-0.5">
            <span class="truncate text-[15px] font-bold" :class="item.outOfStock && 'text-dimmed-foreground'">{{ item.name }}</span>
            <span v-if="item.sub" class="truncate text-[13px] text-muted-foreground">{{ item.sub }}</span>
          </span>
          <span
            class="shrink-0 text-base font-bold tabular-nums"
            :class="item.outOfStock && 'text-muted-foreground'"
          >
            {{ item.number }}
            <span class="text-xs font-semibold text-muted-foreground">{{ item.unit }}</span>
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
