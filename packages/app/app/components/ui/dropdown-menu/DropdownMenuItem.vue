<script setup lang="ts">
import type { DropdownMenuItemProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { cn } from "cn"
import { DropdownMenuItem, useForwardProps } from "reka-ui"

const props = withDefaults(defineProps<DropdownMenuItemProps & {
  class?: HTMLAttributes["class"]
  inset?: boolean
  variant?: "default" | "destructive"
}>(), {
  variant: "default",
})

const delegatedProps = reactiveOmit(props, "inset", "variant", "class")

const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-inset="inset ? '' : undefined"
    :data-variant="variant"
    v-bind="forwardedProps"
    :class="cn(`relative flex items-center gap-2 rounded-(--st-pop-item-r) px-3 py-1.5 text-sm outline-hidden select-none focus:bg-(--glass-hover) focus:text-(--glass-hover-foreground) data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-9 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:text-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`, props.class)"
  >
    <slot />
  </DropdownMenuItem>
</template>
