import { build as neumorphism } from './neumorphism'
import type { StyleBuild } from './types'

/*
 * Neo-brutal: a stub until Task 5 of Plan 10 ports the mock-up's `brutal` branch of build() here (replace this file;
 * see lib/styles/neumorphism.ts for the shape). Until then it is Neumorphism — in blue, since a fixed palette ignores
 * the accent it is given.
 */
export const build: StyleBuild = (mode) => neumorphism(mode, 'blue')
