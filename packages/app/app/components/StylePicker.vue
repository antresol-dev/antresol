<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { toast } from 'vue-sonner'
import { previewVars, styleCards } from '~/lib/appearance-ui'
import { errorMessageKey } from '~/lib/errors'
import { effectiveAccent, isStyleName } from '~/lib/styles/registry'

// Settings → Appearance → Style: nine cards, each a small scene drawn with the style's own tokens in the current theme
// (page, card, primary button, chip, the name in the style's label font). The tokens are CSS variables on the card
// element alone. Every card has the same size; the style never changes it (spec §3). The checked card wears a ring;
// keyboard focus is the global outline, 6 px out (past the ring), so a focused card is never mistaken for the checked one.
const { t } = useI18n()
const appearance = useAppearance()
const colorMode = useColorMode()
const cards = styleCards()

const mode = computed(() => (colorMode.value === 'dark' ? 'dark' : 'light'))
const scenes = computed(() =>
  cards.map(({ name, label }) => ({
    name,
    label,
    vars: Object.fromEntries(previewVars(name, mode.value, effectiveAccent(name, appearance.accent.value))),
  })),
)

async function choose(value: unknown): Promise<void> {
  if (!isStyleName(value) || value === appearance.style.value) return
  try {
    await appearance.setStyle(value)
  } catch (e) {
    toast.error(t(errorMessageKey(e)))
  }
}
</script>

<template>
  <div class="grid gap-3">
    <p id="style-label" class="flex items-baseline justify-between gap-2 text-base font-medium">
      {{ $t('settings.appearance.style') }}
      <span class="text-sm text-muted-foreground">{{ cards.find((c) => c.name === appearance.style.value)?.label }}</span>
    </p>
    <RadioGroupRoot
      :model-value="appearance.style.value"
      aria-labelledby="style-label"
      class="grid grid-cols-2 gap-3 sm:grid-cols-3"
      @update:model-value="choose"
    >
      <RadioGroupItem
        v-for="scene in scenes"
        :key="scene.name"
        :value="scene.name"
        :aria-label="scene.label"
        :style="scene.vars"
        class="style-card group relative block h-24 min-w-0 cursor-pointer overflow-hidden rounded-card text-left focus-visible:outline-offset-[6px] data-[state=checked]:ring-2 data-[state=checked]:ring-ring data-[state=checked]:ring-offset-2 data-[state=checked]:ring-offset-background"
      >
        <span class="style-card-page absolute inset-0 grid content-between p-2.5" aria-hidden="true">
          <span class="style-card-label truncate">{{ scene.label }}</span>
          <span class="style-card-box flex items-center justify-between gap-2 px-2 py-1.5">
            <span class="style-card-chip h-3.5 w-8" />
            <span class="style-card-button h-5 w-11" />
          </span>
        </span>
      </RadioGroupItem>
    </RadioGroupRoot>
  </div>
</template>

<style scoped>
.style-card-page {
  background: var(--st-page);
  color: var(--st-fg);
  font-family: var(--st-font);
}
.style-card-label {
  font-family: var(--st-label-font);
  font-weight: var(--st-label-weight);
  text-transform: var(--st-label-case);
  letter-spacing: var(--st-label-track);
  font-size: 11px;
  line-height: 1.2;
  color: var(--st-subtle);
}
.style-card-box {
  background: var(--st-card);
  color: var(--st-card-fg);
  box-shadow: var(--st-card-sh);
  border-radius: var(--st-card-r);
  height: 2.5rem;
}
.style-card-chip {
  background: var(--st-chips-0);
  box-shadow: var(--st-chip-sh);
  border-radius: var(--st-chip-r);
}
.style-card-button {
  background-color: var(--st-primary-n-bg);
  background-image: var(--st-primary-n-img);
  box-shadow: var(--st-primary-n-sh);
  border-radius: var(--st-prim-r);
}
</style>
