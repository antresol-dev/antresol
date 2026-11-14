<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { iconFrom } from '~/lib/item-icons'

// The "Icon" row of the item and folder forms: the current icon (or "None") and a button that opens the icon sheet.
const props = defineProps<{ icon: string | null; disabled?: boolean }>()
const emit = defineEmits<{ pick: [name: string | null] }>()
const picking = defineModel<boolean>('picking', { default: false })
const iconSet = useItemIconSet()
const current = computed(() => iconFrom(iconSet.value, props.icon))
</script>

<template>
  <div class="grid gap-2">
    <span id="icon-field-label" class="text-sm leading-none font-medium">{{ $t('iconPicker.field') }}</span>
    <button
      type="button"
      aria-labelledby="icon-field-label icon-field-value"
      class="pressable flex h-11 w-full min-w-0 items-center gap-2 rounded-field border border-input bg-field px-3 text-left text-sm disabled:opacity-50"
      :disabled="disabled"
      @click="picking = true"
    >
      <component :is="current" v-if="current" class="size-5 shrink-0 text-icon" aria-hidden="true" />
      <span id="icon-field-value" class="min-w-0 flex-1 truncate">{{ icon ?? $t('iconPicker.noneValue') }}</span>
      <ChevronRight class="size-4 shrink-0 text-icon" aria-hidden="true" />
    </button>
    <IconPicker v-model:open="picking" :current="icon" @pick="emit('pick', $event)" />
  </div>
</template>
