<script setup lang="ts">
import type { UnitDef } from '@graymatter/core'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// An amount as text ("10", "50cm") with its unit: a choice when there are several units, otherwise the symbol at the
// right edge of the field.
const props = defineProps<{ units: UnitDef[]; id?: string; invalid?: boolean }>()
const text = defineModel<string>({ required: true })
const unitKey = defineModel<string>('unitKey', { required: true })

const single = computed(() => (props.units.length === 1 ? props.units[0]! : null))
</script>

<template>
  <div class="flex gap-2">
    <div class="relative min-w-0 flex-1">
      <Input
        :id="id"
        v-model="text"
        inputmode="decimal"
        autocomplete="off"
        :aria-invalid="invalid ? true : undefined"
        class="h-11 rounded-field bg-surface"
        :class="single ? 'pr-14' : ''"
      />
      <span
        v-if="single"
        class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-muted-foreground"
      >
        {{ single.symbol }}
      </span>
    </div>
    <Select v-if="!single" v-model="unitKey">
      <SelectTrigger :aria-label="$t('quickAdd.unit')" class="h-11 w-32 shrink-0 rounded-field bg-surface">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="u in units" :key="u.key" :value="u.key">{{ u.name }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
