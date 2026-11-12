import type { AccentName } from '../accent'
import { build as acrylic } from './acrylic'
import { build as base } from './base'
import { build as brutal } from './brutal'
import { build as linear } from './linear'
import { build as liquid } from './liquid'
import { build as neumorphism } from './neumorphism'
import { build as retro } from './retro'
import { build as tinkerer } from './tinkerer'
import type { StyleInfo, StyleName } from './types'
import { build as y2k } from './y2k'

/* The nine styles (spec §2), in the order of the owner's boards S1–S9. */

export const STYLES: Record<StyleName, StyleInfo> = {
  base: { name: 'base', label: 'Base', fixedPalette: false, defaultAccent: 'indigo', fonts: ['Onest'], build: base },
  neumorphism: { name: 'neumorphism', label: 'Neumorphism', fixedPalette: false, defaultAccent: 'indigo', fonts: ['Manrope'], build: neumorphism },
  acrylic: { name: 'acrylic', label: 'Acrylic', fixedPalette: false, defaultAccent: 'blue', fonts: ['Inter'], build: acrylic },
  liquid: { name: 'liquid', label: 'Liquid glass', fixedPalette: false, defaultAccent: 'blue', fonts: ['Inter'], build: liquid },
  linear: { name: 'linear', label: 'Linear', fixedPalette: false, defaultAccent: 'indigo', fonts: ['Inter'], build: linear },
  // Memphis colours: the accent is nominal, build() ignores it.
  brutal: { name: 'brutal', label: 'Neo-brutal', fixedPalette: true, defaultAccent: 'blue', fonts: ['Rubik', 'Unbounded'], build: brutal },
  y2k: { name: 'y2k', label: 'Y2K', fixedPalette: false, defaultAccent: 'blue', fonts: ['Exo 2'], build: y2k },
  retro: { name: 'retro', label: 'Retro atomic', fixedPalette: true, defaultAccent: 'teal', fonts: ['Jost'], build: retro },
  tinkerer: { name: 'tinkerer', label: 'Tinkerer', fixedPalette: false, defaultAccent: 'copper', fonts: ['IBM Plex Sans', 'IBM Plex Mono'], build: tinkerer },
}

export const STYLE_NAMES: StyleName[] = ['base', 'neumorphism', 'acrylic', 'liquid', 'linear', 'brutal', 'y2k', 'retro', 'tinkerer']

/** Devices without a stored style (the owner, 2026-11-12: the least specific look for most people). */
export const DEFAULT_STYLE: StyleName = 'base'

export function isStyleName(v: unknown): v is StyleName {
  return typeof v === 'string' && Object.hasOwn(STYLES, v)
}

/** The accent a style is drawn with: a fixed palette's own; otherwise the chosen one, or the style's default while the
 *  choice is "Style default" (null). */
export function effectiveAccent(style: StyleName, chosen: AccentName | null): AccentName {
  const info = STYLES[style]
  return info.fixedPalette ? info.defaultAccent : (chosen ?? info.defaultAccent)
}
