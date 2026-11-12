import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Installed icons cannot follow the accent: they keep the owner's tile colour (#17181C). The maskable and Apple icons
// are painted on that same colour (the preset's default is white), with the tile inside the safe zone (padding 0.3).
const TILE = '#17181C'

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { ...minimal2023Preset.maskable.resizeOptions, background: TILE } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { ...minimal2023Preset.apple.resizeOptions, background: TILE } },
  },
  images: ['public/favicon.svg'],
})
