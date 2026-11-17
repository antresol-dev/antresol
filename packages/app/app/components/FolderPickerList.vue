<script setup lang="ts">
import type { Id } from '@antresol/core'
import { Check } from '@lucide/vue'
import type { MoveTarget } from '~/lib/views'

// The folders of the inventory as an indented list inside a form: root first, the chosen one a selected row. The box is a
// field (14) with 4 px padding, so its rows are 10.
// `taken` marks folders where the name being placed already exists: those rows can't be chosen.
defineProps<{ choices: MoveTarget[]; disableCurrent?: boolean; taken?: (id: Id | null) => 'active' | 'archived' | null }>()
const emit = defineEmits<{ select: [id: Id | null] }>()
</script>

<template>
  <ul class="grid max-h-[40dvh] grid-cols-1 gap-0.5 overflow-x-hidden overflow-y-auto rounded-field border border-input bg-field p-1">
    <li v-for="choice in choices" :key="choice.id ?? 'root'" class="min-w-0">
      <button
        type="button"
        :disabled="(disableCurrent && choice.current) || !!taken?.(choice.id)"
        :aria-current="choice.current ? 'true' : undefined"
        class="pressable flex min-h-11 w-full items-center gap-2 rounded-chip py-1.5 pr-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none"
        :class="choice.current ? 'row-selected font-semibold' : ''"
        :style="{ paddingLeft: `${12 + Math.min(choice.depth * 16, 64)}px` }"
        @click="emit('select', choice.id)"
      >
        <span class="flex min-w-0 flex-1 items-center gap-1.5">
          <span class="min-w-0 truncate">{{ choice.name }}</span>
          <RootMark v-if="choice.id === null" />
        </span>
        <span v-if="taken?.(choice.id)" class="shrink-0 text-xs text-destructive">
          {{ $t(taken(choice.id) === 'archived' ? 'nameTaken.inListArchived' : 'nameTaken.inList') }}
        </span>
        <Check v-if="choice.current" class="size-4 shrink-0" aria-hidden="true" />
      </button>
    </li>
  </ul>
</template>
