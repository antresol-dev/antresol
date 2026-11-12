<script setup lang="ts">
import { Check } from '@lucide/vue'
import { RadioGroupIndicator, RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { toast } from 'vue-sonner'
import { isAccentName, type AccentName } from '~/lib/accent'
import { accentChoices } from '~/lib/appearance-ui'
import { errorMessageKey } from '~/lib/errors'
import { STYLES } from '~/lib/styles/registry'

// Settings → Appearance → Accent (spec 4.1): "Style default" first, then round swatches, applied at once and kept on
// this device. A swatch shows the accent as the current style and theme draw it (its `accent` token, the check in the
// primary's text colour). A fixed-palette style (Neo-brutal, Retro atomic) has no choice: a line says so instead.
const { t } = useI18n()
const appearance = useAppearance()
const colorMode = useColorMode()

const choices = computed(() => accentChoices(appearance.style.value))
const DEFAULT = 'default'
const swatches = computed(() => {
  const mode = colorMode.value === 'dark' ? 'dark' : 'light'
  const build = STYLES[appearance.style.value].build
  return Object.fromEntries(
    (choices.value ?? []).filter((c): c is AccentName => c !== null).map((name) => {
      const tokens = build(mode, name)
      return [name, { '--swatch': tokens.accent, '--swatch-fg': tokens.kinds.primary.n.fg }]
    }),
  )
})
const currentLabel = computed(() => {
  const chosen = appearance.accent.value
  return chosen === null ? t('settings.appearance.styleDefault') : t(`settings.appearance.accents.${chosen}`)
})

async function choose(value: unknown): Promise<void> {
  const next: AccentName | null = value === DEFAULT ? null : isAccentName(value) ? value : appearance.accent.value
  if (next === appearance.accent.value) return
  try {
    await appearance.setAccent(next)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p id="accent-label" class="flex items-baseline justify-between gap-2 text-base font-medium">
      {{ $t('settings.appearance.accent') }}
      <span v-if="choices" class="text-sm text-muted-foreground">{{ currentLabel }}</span>
    </p>
    <p v-if="!choices" class="text-sm text-muted-foreground">{{ $t('settings.appearance.fixedPalette') }}</p>
    <RadioGroupRoot
      v-else
      :model-value="appearance.accent.value ?? DEFAULT"
      aria-labelledby="accent-label"
      class="flex flex-wrap items-center gap-2.5"
      @update:model-value="choose"
    >
      <RadioGroupItem
        v-for="choice in choices"
        :key="choice ?? DEFAULT"
        :value="choice ?? DEFAULT"
        :aria-label="choice === null ? $t('settings.appearance.styleDefault') : $t(`settings.appearance.accents.${choice}`)"
        :class="
          choice === null
            ? 'raised pressable inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-medium'
            : 'raised-sm pressable grid size-11 place-items-center rounded-full'
        "
      >
        <template v-if="choice === null">
          {{ $t('settings.appearance.styleDefault') }}
          <RadioGroupIndicator>
            <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          </RadioGroupIndicator>
        </template>
        <span
          v-else
          class="grid size-7 place-items-center rounded-full bg-(--swatch) text-(--swatch-fg)"
          :style="swatches[choice]"
        >
          <RadioGroupIndicator>
            <Check class="size-4" :stroke-width="3" aria-hidden="true" />
          </RadioGroupIndicator>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
  </div>
</template>
