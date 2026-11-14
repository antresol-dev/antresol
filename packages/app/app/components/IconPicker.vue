<script setup lang="ts">
import { Ban, Search } from '@lucide/vue'
import { Input } from '@/components/ui/input'
import { ITEM_ICON_GROUPS, filterIconGroups } from '~/lib/item-icons'

// The icon sheet (plan 14): search by name, "No icon", the owner's groups as grids. The set of components loads on
// first need; until then the grid is a placeholder.
const props = defineProps<{ current: string | null; title?: string }>()
const emit = defineEmits<{ pick: [name: string | null] }>()
const open = defineModel<boolean>('open', { required: true })

const iconSet = useItemIconSet()
const query = ref('')
watch(open, (isOpen) => {
  if (isOpen) query.value = ''
})
const groups = computed(() => filterIconGroups(ITEM_ICON_GROUPS, query.value))

function choose(name: string | null): void {
  emit('pick', name)
  open.value = false
}
const tileClass =
  'pressable grid size-11 place-items-center rounded-field border border-transparent bg-field text-icon aria-pressed:border-ring aria-pressed:ring-2 aria-pressed:ring-ring'
</script>

<template>
  <AppSheet v-model:open="open" :title="title ?? $t('iconPicker.title')">
    <div class="grid gap-3 py-2">
      <div class="relative">
        <Search class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-icon" aria-hidden="true" />
        <Input v-model="query" type="search" autocomplete="off" :placeholder="$t('iconPicker.search')" :aria-label="$t('iconPicker.search')" class="h-11 pl-9" />
      </div>
      <button
        type="button"
        class="pressable flex min-h-11 items-center gap-2 rounded-field border border-transparent bg-field px-3 text-left text-sm aria-pressed:border-ring aria-pressed:ring-2 aria-pressed:ring-ring"
        :aria-pressed="current === null"
        @click="choose(null)"
      >
        <Ban class="size-5 text-icon" aria-hidden="true" />
        {{ $t('iconPicker.none') }}
      </button>
      <div v-if="!iconSet" class="grid grid-cols-[repeat(auto-fill,2.75rem)] gap-1.5" role="status" :aria-label="$t('iconPicker.loading')">
        <span v-for="n in 24" :key="n" class="size-11 rounded-field bg-thumb motion-safe:animate-pulse" />
      </div>
      <p v-else-if="groups.length === 0" class="text-sm text-muted-foreground">{{ $t('iconPicker.empty') }}</p>
      <template v-else>
        <section v-for="g in groups" :key="g.title" :aria-label="g.title" class="grid gap-1.5">
          <h3 class="text-xs font-semibold text-subtle-foreground">{{ g.title }}</h3>
          <div class="grid grid-cols-[repeat(auto-fill,2.75rem)] gap-1.5">
            <button
              v-for="name in g.names"
              :key="name"
              type="button"
              :class="tileClass"
              :aria-label="name"
              :title="name"
              :aria-pressed="props.current === name"
              @click="choose(name)"
            >
              <component :is="iconSet[name]" v-if="iconSet[name]" class="size-6" aria-hidden="true" />
            </button>
          </div>
        </section>
      </template>
    </div>
  </AppSheet>
</template>
