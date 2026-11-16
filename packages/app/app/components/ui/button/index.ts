import type { VariantProps } from "class-variance-authority"
import { cva } from "class-variance-authority"

export { default as Button } from "./Button.vue"

// "Hybrid v2" (assets/css/main.css): the radius (14) and every state come from the variant's design-system classes,
// which sit below Tailwind utilities, so a rounded-* or bg-* passed in still wins. Keyboard focus is the base
// accent outline; disabled buttons neither hover nor sink.
const iconSizes = ["icon", "icon-xs", "icon-sm", "icon-lg"] as const

export const buttonVariants = cva(
  "btn-text inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // The accent button, the only one in colour (anti-goal 4): soft in the light theme, painted in the dark one.
        default: "accent-button pressable",
        destructive: "painted painted-destructive pressable",
        // Actions are neutral: raised, tinted towards the accent only under the pointer. R(4,10) for text buttons,
        // R(3,7) for icon buttons (compound variants below).
        outline: "pressable",
        secondary: "pressable",
        ghost: "pressable",
        link: "rounded-chip text-accent-ink underline-offset-4 hover:underline",
      },
      size: {
        "default": "h-9 px-4 py-2 has-[>svg]:px-3",
        "xs": "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        "sm": "h-8 gap-1.5 px-3 has-[>svg]:px-2",
        "lg": "h-10 px-6 has-[>svg]:px-4",
        "icon": "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    compoundVariants: [
      { variant: ["outline", "secondary"], size: ["default", "xs", "sm", "lg"], class: "raised" },
      { variant: ["outline", "secondary"], size: [...iconSizes], class: "raised-sm" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
export type ButtonVariants = VariantProps<typeof buttonVariants>
