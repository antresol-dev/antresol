<script setup lang="ts">
import type { SelectRootEmits, SelectRootProps } from "reka-ui"
import { reactiveOmit } from "@vueuse/core"
import { SelectRoot, useForwardProps } from "reka-ui"
import { useListLayer } from "~/composables/useListLayer"

const props = withDefaults(defineProps<SelectRootProps>(), { open: undefined, defaultOpen: false })
const emits = defineEmits<SelectRootEmits>()

// The open list is a layer: the back gesture closes it, not the sheet it sits in.
const open = useListLayer(props, (value) => emits("update:open", value))
const forwarded = useForwardProps(reactiveOmit(props, "open", "defaultOpen"))
</script>

<template>
  <SelectRoot
    v-slot="slotProps"
    v-model:open="open"
    data-slot="select"
    v-bind="forwarded"
    @update:model-value="emits('update:modelValue', $event)"
  >
    <slot v-bind="slotProps" />
  </SelectRoot>
</template>
