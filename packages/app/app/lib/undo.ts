import { newId, type Command, type Id } from '@graymatter/core'
import { toast } from 'vue-sonner'
import { errorMessageKey } from './errors'

/** A toast never leaves sooner than this (spec 4.13); vue-sonner pauses its timer while a pointer or finger is on it. */
export const UNDO_MIN_MS = 6000

export interface UndoDeps {
  /** Shows a toast with an action; onGone fires when it closes by itself or is dismissed. Returns its id. */
  show(label: string, o: { duration: number; actionLabel: string; onAction(): void; onGone(): void }): string | number
  dismiss(id: string | number): void
  apply(command: Command): Promise<void>
  actionLabel(): string
  onError(e: unknown): void
}

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  /** True when typing goes to a field: its own native undo wins. */
  inField: boolean
  preventDefault(): void
}

export function createUndo(deps: UndoDeps) {
  // The toasts still on screen, newest last: Ctrl/⌘+Z undoes the newest.
  const live: { id: string | number; run(): void }[] = []

  function undoToast(label: string, undo: Command, opts: { minMs?: number } = {}): void {
    let done = false
    const entry = { id: 0 as string | number, run: () => {} }
    const forget = (): void => {
      const i = live.indexOf(entry)
      if (i >= 0) live.splice(i, 1)
    }
    entry.run = () => {
      if (done) return
      done = true
      forget()
      deps.dismiss(entry.id)
      deps.apply(undo).catch(deps.onError)
    }
    entry.id = deps.show(label, {
      duration: Math.max(opts.minMs ?? UNDO_MIN_MS, UNDO_MIN_MS),
      actionLabel: deps.actionLabel(),
      onAction: entry.run,
      onGone: () => {
        done = true
        forget()
      },
    })
    if (!done) live.push(entry)
  }

  /** Ctrl/⌘+Z while a toast is visible. Returns whether it undid something. */
  function onKey(e: KeyLike): boolean {
    if (e.key.toLowerCase() !== 'z' || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.inField) return false
    const last = live[live.length - 1]
    if (!last) return false
    e.preventDefault()
    last.run()
    return true
  }

  return { undoToast, onKey }
}

/** Archives at once and offers Undo: the toast sends `restore` with the same archiveId. */
export async function archiveAtOnce(
  apply: (c: Command) => Promise<void>,
  undoToast: (label: string, undo: Command) => void,
  target: 'folder' | 'item' | 'variant',
  id: Id,
  label: string,
): Promise<void> {
  const archiveId = newId()
  await apply({ type: 'archive', target, id, archiveId })
  undoToast(label, { type: 'restore', archiveId })
}

let real: ReturnType<typeof createUndo> | null = null

/** Wires the real deps once, on the client: the toast lane, the workspace and the Ctrl/⌘+Z listener. */
function runtime(): ReturnType<typeof createUndo> {
  if (real) return real
  const { t } = useNuxtApp().$i18n
  const workspace = useWorkspace()
  real = createUndo({
    show: (label, o) =>
      toast(label, {
        duration: o.duration,
        action: { label: o.actionLabel, onClick: o.onAction },
        onDismiss: o.onGone,
        onAutoClose: o.onGone,
      }),
    dismiss: (id) => void toast.dismiss(id),
    apply: (c) => workspace.apply(c),
    actionLabel: () => t('undo.action'),
    onError: (e) => toast.error(t(errorMessageKey(e))),
  })
  const core = real
  document.addEventListener('keydown', (e) => {
    const el = e.target instanceof HTMLElement ? e.target : null
    core.onKey({
      key: e.key,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      shiftKey: e.shiftKey,
      inField: !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)),
      preventDefault: () => e.preventDefault(),
    })
  })
  return real
}

export const undoToast = (label: string, undo: Command, opts?: { minMs?: number }): void => runtime().undoToast(label, undo, opts)

/** Archive an item, folder or variant with no confirmation; the Undo toast says what happened. */
export async function archiveNow(target: 'folder' | 'item' | 'variant', id: Id, name: string): Promise<void> {
  const { t } = useNuxtApp().$i18n
  await archiveAtOnce((c) => useWorkspace().apply(c), undoToast, target, id, t('undo.archived', { name }))
}
