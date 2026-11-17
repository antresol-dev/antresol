<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import { colorVars } from '~/lib/item-colors'
import { iconFrom } from '~/lib/item-icons'

// The "Icon" row of the item and folder forms: the current icon (or "None") and a button that opens the icon sheet.
const props = defineProps<{ icon: string | null; color?: string; disabled?: boolean }>()
const emit = defineEmits<{ pick: [name: string | null] }>()
const picking = defineModel<boolean>('picking', { default: false })
const iconSet = useItemIconSet()
const uid = useId()
const current = computed(() => iconFrom(iconSet.value, props.icon))
</script>

<template>
  <div class="grid gap-2">
    <span :id="`${uid}-label`" class="field-text text-sm leading-none font-medium">{{ $t('iconPicker.field') }}</span>
    <button
      type="button"
      :aria-labelledby="`${uid}-label ${uid}-value`"
      class="pressable flex h-11 w-full min-w-0 items-center gap-2 rounded-field border border-input bg-field px-3 text-left text-sm disabled:opacity-50"
      :disabled="disabled"
      @click="picking = true"
    >
      <component :is="current" v-if="current" class="size-5 shrink-0" :class="color ? 'colored text-(--c)' : 'text-icon'" :style="color ? colorVars(color) : undefined" aria-hidden="true" />
      <span :id="`${uid}-value`" class="min-w-0 flex-1 truncate">{{ icon ?? $t('iconPicker.noneValue') }}</span>
      <ChevronRight class="size-4 shrink-0 text-icon" aria-hidden="true" />
    </button>
    <IconPicker v-model:open="picking" :current="icon" @pick="emit('pick', $event)" />
  </div>
</template>
