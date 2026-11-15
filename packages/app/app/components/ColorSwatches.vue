<script setup lang="ts">
import { Check } from '@lucide/vue'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { paletteName, swatchChoices } from '~/lib/item-colors'

// A colour choice for an item or a tag, after AccentPicker: a radio group of round swatches. The first one is "Auto"
// (drawn in `auto`, the colour the item gets without a choice) or "None" (a tag without a colour). A colour that is not
// in the palette (written by the MCP) shows as one more, selected, swatch so a save does not lose it.
const props = defineProps<{ auto: string | null; label: string; disabled?: boolean }>()
const model = defineModel<string | null>({ required: true })
const AUTO = 'auto'
const labelId = useId()
const choices = computed(() => swatchChoices(model.value))

function choose(value: unknown): void {
  if (props.disabled) return
  if (value === AUTO) model.value = null
  else if (typeof value === 'string') model.value = value
}
</script>

<template>
  <div class="grid gap-2">
    <span :id="labelId" class="text-sm leading-none font-medium">{{ label }}</span>
    <RadioGroupRoot
      :model-value="model ?? AUTO"
      :aria-labelledby="labelId"
      :disabled="disabled"
      class="flex flex-wrap items-center gap-3"
      @update:model-value="choose"
    >
      <RadioGroupItem
        :value="AUTO"
        class="raised pressable inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium disabled:opacity-50"
      >
        <span v-if="auto" class="size-4 rounded-full bg-(--swatch)" :style="{ '--swatch': auto }" aria-hidden="true" />
        {{ auto ? $t('colors.auto') : $t('colors.none') }}
        <RadioGroupIndicator>
          <Check class="size-4" :stroke-width="3" aria-hidden="true" />
        </RadioGroupIndicator>
      </RadioGroupItem>
      <RadioGroupItem
        v-for="hex in choices"
        :key="hex"
        :value="hex"
        :aria-label="paletteName(hex) ? $t(`settings.appearance.accents.${paletteName(hex)}`) : hex"
        class="raised-sm pressable grid size-11 place-items-center rounded-full disabled:opacity-50"
      >
        <span class="grid size-7 place-items-center rounded-full bg-(--swatch) text-white" :style="{ '--swatch': hex }">
          <RadioGroupIndicator>
            <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          </RadioGroupIndicator>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
  </div>
</template>
