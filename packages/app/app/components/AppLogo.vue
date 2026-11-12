<script setup lang="ts">
import { LOGO_DOORS, logoColor } from '~/lib/brand'

// Tile and pulls follow the effective accent (lib/brand.ts); the doors stay white. Size comes from the class.
const appearance = useAppearance()
const color = computed(() => logoColor(appearance.effectiveAccent.value))
</script>

<template>
  <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false" :style="{ '--logo': color }">
    <rect width="100" height="100" rx="24" fill="var(--logo)" />
    <g :fill="LOGO_DOORS">
      <rect x="14" y="28" width="35" height="44" rx="8" />
      <rect x="51" y="28" width="35" height="44" rx="8" />
    </g>
    <g fill="var(--logo)">
      <rect x="40" y="42" width="5" height="16" rx="2.5" />
      <rect x="55" y="42" width="5" height="16" rx="2.5" />
    </g>
  </svg>
</template>
