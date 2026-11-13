<script setup lang="ts">
import { Ellipsis } from '@lucide/vue'
import type { Component } from 'vue'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// The phone header's "⋯" (design system, Header and Menu): the screen's less frequent actions, by frequency, the
// destructive ones last after a separator.
export interface HeaderMenuAction {
  key: string
  label: string
  icon: Component
  run: () => void
  destructive?: boolean
  disabled?: boolean
}

const props = defineProps<{ actions: HeaderMenuAction[] }>()

const open = ref(false)
useCloseWatcher(open)

const safe = computed(() => props.actions.filter((a) => !a.destructive))
const destructive = computed(() => props.actions.filter((a) => a.destructive))
</script>

<template>
  <DropdownMenu v-model:open="open">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="pressable grid size-11 shrink-0 place-items-center rounded-chip text-icon data-[state=open]:bg-(--ghost-pressed) data-[state=open]:text-accent-ink"
        :aria-label="$t('nav.more')"
      >
        <Ellipsis class="size-5" aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="grid w-56 gap-0.5 motion-safe:data-[state=open]:animate-pop-in motion-safe:data-[state=closed]:animate-pop-out"
    >
      <DropdownMenuItem
        v-for="a in safe"
        :key="a.key"
        :disabled="a.disabled"
        class="min-h-11 gap-3 px-3 font-semibold"
        @select="a.run"
      >
        <component :is="a.icon" class="size-5" aria-hidden="true" />
        {{ a.label }}
      </DropdownMenuItem>
      <template v-if="destructive.length > 0">
        <DropdownMenuSeparator v-if="safe.length > 0" />
        <DropdownMenuItem
          v-for="a in destructive"
          :key="a.key"
          :disabled="a.disabled"
          variant="destructive"
          class="min-h-11 gap-3 px-3 font-semibold"
          @select="a.run"
        >
          <component :is="a.icon" class="size-5" aria-hidden="true" />
          {{ a.label }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
