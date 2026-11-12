<script setup lang="ts">
import { Check } from '@lucide/vue'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { toast } from 'vue-sonner'
import { ACCENT_NAMES, ACCENTS, isAccentName } from '~/lib/accent'
import { errorMessageKey } from '~/lib/errors'
import { mix } from '~/lib/styles/color'

// Settings → Appearance → Accent (spec 4.1): round swatches, applied at once and kept on this device. Each swatch shows
// the colour of the current theme; the check takes the accent's own text colour. Until Task 7 of Plan 10 redesigns
// this picker ("Style default", copper and its label), it shows the ten accents as before, the dark swatch the accent
// lifted by 12 % white as before.
const { t } = useI18n()
const appearance = useAppearance()
const names = ACCENT_NAMES.filter((name) => name !== 'copper')

async function choose(value: unknown): Promise<void> {
  if (!isAccentName(value) || value === appearance.effectiveAccent.value) return
  try {
    await appearance.setAccent(value)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p id="accent-label" class="flex items-baseline justify-between gap-2 text-base font-medium">
      {{ $t('settings.appearance.accent') }}
      <span class="text-sm text-muted-foreground">{{ $t(`settings.appearance.accents.${appearance.effectiveAccent.value}`) }}</span>
    </p>
    <RadioGroupRoot
      :model-value="appearance.effectiveAccent.value"
      aria-labelledby="accent-label"
      class="flex flex-wrap gap-2.5"
      @update:model-value="choose"
    >
      <RadioGroupItem
        v-for="name in names"
        :key="name"
        :value="name"
        :aria-label="$t(`settings.appearance.accents.${name}`)"
        class="raised-sm pressable grid size-11 place-items-center rounded-full"
      >
        <span
          class="grid size-7 place-items-center rounded-full bg-(--swatch-light) text-accent-foreground dark:bg-(--swatch-dark)"
          :style="{ '--swatch-light': ACCENTS[name].light, '--swatch-dark': mix(ACCENTS[name].light, '#ffffff', 0.12) }"
        >
          <RadioGroupIndicator>
            <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          </RadioGroupIndicator>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
  </div>
</template>
