<script setup lang="ts">
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'

const colorMode = useColorMode()
const options = ['system', 'light', 'dark'] as const
</script>

<template>
  <RadioGroup
    :model-value="colorMode.preference"
    class="grid gap-0.5"
    @update:model-value="(v) => (colorMode.preference = String(v))"
  >
    <Label
      v-for="option in options"
      :key="option"
      :for="`theme-${option}`"
      class="-mx-3 min-h-11 rounded-chip px-3 text-base font-medium transition-colors duration-150 hover:bg-hover"
    >
      <RadioGroupItem :id="`theme-${option}`" :value="option" class="size-5" />
      {{ $t(`settings.appearance.${option}`) }}
    </Label>
  </RadioGroup>
</template>
