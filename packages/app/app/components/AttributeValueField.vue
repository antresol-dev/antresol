<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// A value of an attribute: free text, or one of the options of a list attribute (or none).
defineProps<{ id: string; label: string; kind: 'text' | 'enum'; options: string[]; disabled?: boolean }>()
const value = defineModel<string>({ required: true })

// A Select item can't have an empty value.
const NONE = '\u0000none'
</script>

<template>
  <div class="grid gap-1.5">
    <Label :for="id">{{ label }}</Label>
    <Select v-if="kind === 'enum'" :model-value="value === '' ? NONE : value" :disabled="disabled" @update:model-value="value = $event === NONE ? '' : String($event)">
      <SelectTrigger :id="id" class="h-11 w-full rounded-field bg-surface">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem :value="NONE">{{ $t('item.noValue') }}</SelectItem>
        <SelectItem v-for="o in options" :key="o" :value="o">{{ o }}</SelectItem>
      </SelectContent>
    </Select>
    <Input v-else :id="id" v-model="value" autocomplete="off" :disabled="disabled" class="h-11 rounded-field bg-surface" />
  </div>
</template>
