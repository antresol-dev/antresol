<script setup lang="ts">
import type { DialogOverlayProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "cn"
import { DialogOverlay } from "reka-ui"

const props = defineProps<DialogOverlayProps & { class?: HTMLAttributes["class"] }>()

const delegatedProps = reactiveOmit(props, "class")
</script>

<template>
  <DialogOverlay
    data-slot="dialog-overlay"
    v-bind="delegatedProps"
    :class="cn('data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out md:motion-safe:data-[state=open]:[animation-duration:var(--dur-base)] md:motion-safe:data-[state=closed]:[animation-duration:var(--dur-fast)] fixed inset-0 z-50 bg-(--st-overlay)', props.class)"
  >
    <slot />
  </DialogOverlay>
</template>
