<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"
import { cn } from "cn"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  defaultValue?: string | number
  modelValue?: string | number
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="cn('border-input bg-field placeholder:text-muted-foreground focus-visible:border-ring aria-invalid:border-destructive aria-invalid:outline-destructive flex field-sizing-content min-h-16 w-full rounded-field border px-3 py-2 text-base transition-colors disabled:cursor-not-allowed disabled:opacity-50 md:text-sm', props.class)"
  />
</template>
