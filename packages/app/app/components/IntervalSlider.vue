<script setup lang="ts">
import { CHECK_INTERVALS, type CheckInterval } from '~/lib/workspace-types'

// "Check for changes": a slider over the interval steps (5 min … 1 week, then Never), a dot per step. The steps grow
// roughly geometrically, so even spacing reads as a logarithmic scale. Saved when the thumb is let go.
const props = defineProps<{ id?: string; modelValue: CheckInterval }>()
const emit = defineEmits<{ 'update:modelValue': [value: CheckInterval] }>()
const { t } = useI18n()

const last = CHECK_INTERVALS.length - 1
const index = ref(CHECK_INTERVALS.indexOf(props.modelValue))
watch(
  () => props.modelValue,
  (v) => {
    index.value = CHECK_INTERVALS.indexOf(v)
  },
)
const shown = computed<CheckInterval>(() => CHECK_INTERVALS[index.value] ?? props.modelValue)
const label = (i: CheckInterval): string => t(i === 'never' ? 'sync.never' : `sync.every${i}`)

function onInput(event: Event): void {
  index.value = Number((event.target as HTMLInputElement).value)
}
function onChange(): void {
  const v = CHECK_INTERVALS[index.value]
  if (v && v !== props.modelValue) emit('update:modelValue', v)
}
// The dot's centre: the thumb (20 px) travels between 10 px from each end.
const at = (i: number): string => `calc(10px + (100% - 20px) * ${i / last})`
</script>

<template>
  <div class="grid gap-1">
    <p class="ps-(--field-inset) text-base font-semibold" aria-hidden="true">{{ label(shown) }}</p>
    <div class="relative h-11">
      <div class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" aria-hidden="true">
        <div class="h-full rounded-full bg-primary" :style="{ width: at(index) }" />
      </div>
      <span
        v-for="(_, i) in CHECK_INTERVALS"
        :key="i"
        aria-hidden="true"
        :class="[
          'pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
          i <= index ? 'bg-primary-foreground/80' : 'bg-subtle-foreground/60',
        ]"
        :style="{ left: at(i) }"
      />
      <input
        :id="id"
        type="range"
        class="interval-slider absolute inset-0 h-11 w-full"
        min="0"
        :max="last"
        step="1"
        :value="index"
        :aria-valuetext="label(shown)"
        @input="onInput"
        @change="onChange"
      >
    </div>
    <!-- Inset like the field text: the ends then sit under the first and last dots (10 px in). -->
    <div class="flex justify-between px-(--field-inset) text-xs text-subtle-foreground" aria-hidden="true">
      <span>{{ $t('sync.intervalShortMin') }}</span>
      <span>{{ $t('sync.never') }}</span>
    </div>
  </div>
</template>

<style scoped>
.interval-slider {
  appearance: none;
  background: transparent;
  margin: 0;
}
.interval-slider::-webkit-slider-runnable-track {
  height: 44px;
  background: transparent;
}
.interval-slider::-moz-range-track {
  height: 44px;
  background: transparent;
}
.interval-slider::-webkit-slider-thumb {
  appearance: none;
  margin-top: 12px;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: var(--primary);
  border: 3px solid var(--background);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
}
.interval-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: var(--primary);
  border: 3px solid var(--background);
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.3);
}
.interval-slider:focus-visible {
  outline-offset: 0;
  border-radius: var(--radius-field);
}
</style>
