<script setup lang="ts">
import { Check } from '@lucide/vue'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { toast } from 'vue-sonner'
import { ACCENT_NAMES, ACCENTS, isAccentName } from '~/lib/accent'
import { errorMessageKey } from '~/lib/errors'

// Settings → Appearance → Accent (spec 4.1): round swatches, applied at once and kept on this device. Each swatch shows
// the colour of the current theme; the check takes the accent's own text colour (white, or dark on the dark theme).
const { t } = useI18n()
const accent = useAccent()

async function choose(value: unknown): Promise<void> {
  if (!isAccentName(value) || value === accent.current.value) return
  try {
    await accent.set(value)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p id="accent-label" class="flex items-baseline justify-between gap-2 text-base font-medium">
      {{ $t('settings.appearance.accent') }}
      <span class="text-sm text-muted-foreground">{{ $t(`settings.appearance.accents.${accent.current.value}`) }}</span>
    </p>
    <RadioGroupRoot
      :model-value="accent.current.value"
      aria-labelledby="accent-label"
      class="flex flex-wrap gap-2.5"
      @update:model-value="choose"
    >
      <RadioGroupItem
        v-for="name in ACCENT_NAMES"
        :key="name"
        :value="name"
        :aria-label="$t(`settings.appearance.accents.${name}`)"
        class="raised-sm pressable grid size-11 place-items-center rounded-full"
      >
        <span
          class="grid size-7 place-items-center rounded-full bg-(--swatch-light) text-accent-foreground dark:bg-(--swatch-dark)"
          :style="{ '--swatch-light': ACCENTS[name].light, '--swatch-dark': ACCENTS[name].dark }"
        >
          <RadioGroupIndicator>
            <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          </RadioGroupIndicator>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
  </div>
</template>
