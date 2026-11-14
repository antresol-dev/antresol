import type { Component } from 'vue'

// The owner's icon groups (plan 14): Lucide names in picker order. Names only: the components live in item-icon-set.ts,
// loaded on demand, so the main bundle does not carry them.
export interface ItemIconGroup {
  title: string
  names: string[]
}

export const ITEM_ICON_GROUPS: ItemIconGroup[] = [
  {
    title: 'Хранение и упаковка',
    names: ['package', 'package-2', 'package-open', 'box', 'boxes', 'archive', 'container', 'carton', 'barrel', 'can', 'amphora', 'backpack', 'briefcase', 'briefcase-business', 'luggage', 'handbag', 'shopping-bag', 'shopping-basket', 'paper-bag', 'groceries', 'gift', 'wallet', 'wallet-minimal', 'mailbox', 'vault', 'shelving-unit', 'toolbox', 'tool-case', 'plant-pot', 'bottle-wine', 'pill-bottle', 'tube-lotion', 'perfume-bottle', 'soap-dispenser-droplet', 'milk', 'can-soda', 'cup-soda', 'glass-water', 'coffee', 'trash', 'tag', 'tags', 'baggage-claim'],
  },
  {
    title: 'Электроника и компоненты',
    names: ['cpu', 'microchip', 'circuit-board', 'memory-stick', 'gpu', 'hard-drive', 'server', 'server-nas', 'pc-case', 'computer', 'laptop', 'laptop-minimal', 'monitor', 'monitor-pc', 'keyboard', 'mouse', 'smartphone', 'tablet', 'tablet-smartphone', 'tv', 'tv-minimal', 'projector', 'printer', 'printer-3d', 'webcam', 'camera', 'cctv', 'drone', 'router', 'radio', 'radio-receiver', 'satellite-dish', 'antenna', 'speaker', 'boom-box', 'headphones', 'headset', 'earbuds', 'mic', 'mic-vocal', 'turntable', 'cassette-tape', 'disc', 'disc-3', 'videotape', 'film', 'gamepad', 'gamepad-2', 'gamepad-directional', 'joystick', 'calculator', 'watch', 'alarm-clock', 'flashlight', 'lightbulb', 'battery', 'battery-full', 'battery-charging', 'car-battery', 'plug', 'plug-zap', 'unplug', 'cable', 'usb', 'usb-c-port', 'hdmi-port', 'ethernet-port', 'midi-port', 'card-sim', 'nfc', 'power', 'zap', 'magnet', 'fan', 'heater', 'solar-panel', 'ev-charger', 'bell-electric', 'alarm-smoke', 'robot-arm', 'robot-vacuum', 'bot', 'keyboard-music', 'smartphone-charging', 'spool', 'thermometer', 'gauge', 'scale', 'weight', 'component', 'atom', 'binary', 'bluetooth', 'wifi', 'laser', 'utility-pole', 'radio-tower', 'satellite'],
  },
  {
    title: 'Инструменты и крепёж',
    names: ['wrench', 'hammer', 'drill', 'axe', 'pickaxe', 'shovel', 'anvil', 'screw', 'nut', 'bolt', 'scissors', 'pocket-knife', 'ruler', 'ruler-dimension-line', 'drafting-compass', 'pencil-ruler', 'paintbrush', 'paintbrush-vertical', 'paint-roller', 'paint-bucket', 'spray-can', 'brush', 'pipette', 'funnel', 'hard-hat', 'fire-extinguisher', 'broom', 'mop', 'brush-cleaning', 'key', 'key-round', 'lock', 'lock-keyhole', 'fishing-rod', 'fishing-hook', 'hiking-stick', 'construction', 'traffic-cone', 'gavel', 'sword', 'shield', 'cog', 'settings', 'lasso', 'flame-kindling'],
  },
  {
    title: 'Мебель и дом',
    names: ['armchair', 'sofa', 'bed', 'bed-double', 'bed-single', 'rocking-chair', 'lamp', 'lamp-ceiling', 'lamp-floor', 'lamp-wall-down', 'lamp-wall-up', 'blinds', 'bath', 'shower-head', 'toilet', 'towel-rack', 'faucet', 'washing-machine', 'refrigerator', 'microwave', 'blender', 'cooking-pot', 'utensils', 'mirror-round', 'mirror-rectangular', 'umbrella', 'toothbrush', 'bell', 'chef-hat', 'concierge-bell', 'air-vent', 'parasol', 'clock', 'hourglass', 'door-open', 'door-closed', 'fence', 'house', 'flower-2'],
  },
  {
    title: 'Одежда и личное',
    names: ['shirt', 'sport-shoe', 'glasses', 'gem', 'crown', 'ribbon', 'hat-glasses', 'baby', 'id-card', 'credit-card', 'medal', 'venetian-mask', 'feather', 'award'],
  },
  {
    title: 'Канцелярия и бумага',
    names: ['book', 'book-open', 'notebook', 'notebook-pen', 'notepad-text', 'clipboard', 'sticky-note', 'paperclip', 'pin', 'pen', 'pencil', 'highlighter', 'eraser', 'stamp', 'sticker', 'newspaper', 'swatch-book', 'palette', 'scroll', 'library', 'origami', 'presentation', 'certificate', 'receipt', 'banknote', 'coins', 'piggy-bank', 'mail', 'file'],
  },
  {
    title: 'Хобби, спорт, музыка, игры',
    names: ['bike', 'scooter', 'dumbbell', 'volleyball', 'rugby-ball', 'hockey-stick', 'kayak', 'tent', 'bow-arrow', 'guitar', 'guitar-electric', 'drum', 'piano', 'metronome', 'dices', 'playing-cards', 'chess-knight', 'toy-brick', 'puzzle', 'telescope', 'binoculars', 'microscope', 'compass', 'whistle', 'chess-pawn', 'chess-rook', 'chess-queen', 'chess-king', 'chess-bishop', 'sailboat', 'swords', 'trophy', 'balloon', 'clapperboard', 'rocket'],
  },
  {
    title: 'Лаборатория и медицина',
    names: ['flask-conical', 'flask-round', 'beaker', 'test-tube', 'test-tubes', 'syringe', 'pill', 'tablets', 'bandage', 'stethoscope', 'briefcase-medical', 'iv-bag', 'dna', 'radiation', 'biohazard', 'heart-pulse'],
  },
  {
    title: 'Транспорт',
    names: ['car', 'motorbike', 'plane'],
  },
  {
    title: 'Еда и продукты',
    names: ['apple', 'banana', 'carrot', 'egg', 'wheat', 'bean', 'cookie', 'cake', 'croissant', 'pizza', 'sandwich', 'soup', 'salad', 'cherry', 'grape', 'citrus', 'avocado', 'mango', 'broccoli', 'leafy-green', 'beef', 'ham', 'bacon', 'drumstick', 'fish', 'shrimp', 'candy', 'lollipop', 'ice-cream-cone', 'popsicle', 'donut', 'cupcake', 'popcorn', 'wine', 'beer', 'martini'],
  },
  {
    title: 'Сад и природа',
    names: ['sprout', 'flower', 'leaf', 'rose', 'stone', 'shell', 'bone', 'bird', 'cat', 'dog'],
  },
]

const KNOWN = new Set(ITEM_ICON_GROUPS.flatMap((g) => g.names))

/** Whether the name is in the owner's set (an unknown name is drawn as if there were no icon). */
export const isItemIcon = (name: string | null | undefined): name is string => typeof name === 'string' && KNOWN.has(name)

export type ItemIconSet = Record<string, Component>

let loading: Promise<ItemIconSet> | null = null
/** The component set, imported on first need as a chunk of its own; one shared promise. A failed import is retried next time. */
export function loadItemIconSet(): Promise<ItemIconSet> {
  loading ??= import('./item-icon-set').then(
    (m) => m.ITEM_ICON_SET,
    (e) => {
      loading = null
      throw e
    },
  )
  return loading
}

/** The component for an icon name, or null when the name is unknown or the set has not loaded: callers fall to the next step. */
export const iconFrom = (set: ItemIconSet | null, name: string | null | undefined): Component | null =>
  set && isItemIcon(name) ? (set[name] ?? null) : null
