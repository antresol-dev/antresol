<script setup lang="ts">
import { Pencil, Plus, Trash2 } from '@lucide/vue'
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import type { AttributeRow } from '~/lib/item-view'

defineProps<{ attributes: AttributeRow[] }>()
const emit = defineEmits<{ add: []; edit: [attributeId: Id]; remove: [attributeId: Id] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const locked = computed(() => !!state.readOnly || state.saving)
const actions = computed(() => [
  { key: 'edit', label: t('item.editValue'), icon: Pencil, disabled: locked.value },
  { key: 'remove', label: t('item.removeAttribute'), icon: Trash2, destructive: true, disabled: locked.value },
])
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="px-1 text-[13px] font-semibold text-subtle-foreground">{{ $t('item.attributes') }}</h2>
    <dl v-if="attributes.length > 0" class="rounded-card border border-border bg-surface py-1">
      <div
        v-for="a in attributes"
        :key="a.attributeId"
        class="relative flex min-h-11 items-center justify-between gap-2 py-1 pr-1 pl-3.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <dt class="min-w-0 text-[15px] text-muted-foreground wrap-anywhere">{{ a.name }}</dt>
        <dd class="ml-auto min-w-0 text-right text-[15px] wrap-anywhere">
          <template v-if="a.perVariant"><span class="text-muted-foreground">{{ $t('item.differsByVariant') }}</span></template>
          <template v-else-if="a.value === null">
            <span class="text-muted-foreground" aria-hidden="true">{{ $t('item.noValue') }}</span>
            <span class="sr-only">{{ $t('item.noValueLabel') }}</span>
          </template>
          <template v-else><span class="font-semibold">{{ a.value }}</span></template>
        </dd>
        <RowMenu
          class="size-11"
          :label="a.name"
          :actions="actions"
          @select="(key) => (key === 'edit' ? emit('edit', a.attributeId) : emit('remove', a.attributeId))"
        />
      </div>
    </dl>
    <Button variant="outline" class="h-11 justify-self-start rounded-field bg-surface px-4 font-bold" :disabled="locked" @click="emit('add')">
      <Plus class="size-5" aria-hidden="true" />
      {{ $t('item.addAttribute') }}
    </Button>
  </section>
</template>
