<script setup lang="ts">
import type { ComboboxRootEmits, ComboboxRootProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { ComboboxRoot, useForwardProps } from "reka-ui"
import { useListLayer } from "~/composables/useListLayer"

const props = withDefaults(defineProps<ComboboxRootProps>(), { open: undefined, defaultOpen: false })
const emits = defineEmits<ComboboxRootEmits>()

// The open list is a layer: the back gesture closes it, not the sheet it sits in.
const open = useListLayer(props, (value) => emits("update:open", value))
const forwarded = useForwardProps(reactiveOmit(props, "open", "defaultOpen"))
</script>

<template>
  <ComboboxRoot
    v-slot="slotProps"
    v-model:open="open"
    data-slot="combobox"
    v-bind="forwarded"
    @update:model-value="emits('update:modelValue', $event)"
    @highlight="emits('highlight', $event)"
  >
    <slot v-bind="slotProps" />
  </ComboboxRoot>
</template>
