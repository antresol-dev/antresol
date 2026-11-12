<script setup lang="ts">
import { Pencil, Plus, Split, Trash2 } from '@lucide/vue'
import type { Id } from '@graymatter/core'
import { Button } from '@/components/ui/button'
import type { AttributeRow } from '~/lib/item-view'

defineProps<{ attributes: AttributeRow[] }>()
const emit = defineEmits<{ add: []; edit: [attributeId: Id]; axis: [attributeId: Id]; remove: [attributeId: Id] }>()

const { t } = useI18n()
const { state } = useWorkspace()
const locked = computed(() => !!state.readOnly || state.saving)
const actions = computed(() => [
  { key: 'edit', label: t('item.editValue'), icon: Pencil, disabled: locked.value },
  { key: 'axis', label: t('item.makeAxis'), icon: Split, disabled: locked.value },
  { key: 'remove', label: t('item.removeAttribute'), icon: Trash2, destructive: true, disabled: locked.value },
])
</script>

<template>
  <section class="grid min-w-0 grid-cols-1 gap-2">
    <h2 class="section-label px-1 text-[13px]">{{ $t('item.attributes') }}</h2>
    <!-- A flat list on the page, rows divided by lines. -->
    <dl v-if="attributes.length > 0" class="surface-list">
      <div
        v-for="a in attributes"
        :key="a.attributeId"
        class="relative flex min-h-12 items-center justify-between gap-2 py-0.5 pl-3.5 not-first:before:absolute not-first:before:top-0 not-first:before:right-0 not-first:before:left-3.5 not-first:before:h-px not-first:before:bg-divider not-first:before:content-['']"
      >
        <dt class="min-w-0 text-[15px] text-muted-foreground wrap-anywhere">{{ a.name }}</dt>
        <dd class="ml-auto min-w-0 text-right text-[15px] wrap-anywhere">
          <template v-if="a.display === null">
            <span class="text-muted-foreground" aria-hidden="true">{{ $t('item.noValue') }}</span>
            <span class="sr-only">{{ $t('item.noValueLabel') }}</span>
          </template>
          <template v-else><span class="font-semibold">{{ a.display }}</span></template>
        </dd>
        <RowMenu
          class="h-11 w-10"
          :label="a.name"
          :actions="actions"
          @select="(key) => (key === 'edit' ? emit('edit', a.attributeId) : key === 'axis' ? emit('axis', a.attributeId) : emit('remove', a.attributeId))"
        />
      </div>
    </dl>
    <Button variant="outline" class="mt-1 h-11 justify-self-start px-4.5 font-bold" :disabled="locked" @click="emit('add')">
      <Plus class="size-5" aria-hidden="true" />
      {{ $t('item.addAttribute') }}
    </Button>
  </section>
</template>
