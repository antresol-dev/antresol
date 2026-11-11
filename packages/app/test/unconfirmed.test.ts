import { DomainError, newId, StorageError, type Command } from '@graymatter/core'
import { describe, expect, it } from 'vitest'
import { createUnconfirmedSender, isUnknownOutcome, landedBefore, payloadId } from '../app/lib/unconfirmed'

const use = (quantity = '3'): Command => ({ type: 'stock.use', movementId: newId(), itemId: 'i', variantId: null, quantity, note: null })
const receive = (): Command => ({
  type: 'stock.receive', movementId: newId(), itemId: 'i', variantId: null, quantity: '3', totalPrice: null, sourceUrl: null, note: null,
})
const count = (target: string): Command => ({ type: 'stock.set', movementId: newId(), itemId: 'i', variantId: null, target, note: null })
const create = (): Command => ({
  type: 'item.create', id: newId(), inventoryId: 'inv', folderId: null, name: 'Bolt', description: null, unitKey: 'pcs', tagIds: [], initialReceipt: null,
})

const lost = new StorageError('unavailable')

/** An apply that fails with the queued errors in order, then succeeds; `sent` records every command it got. */
function source(...errors: unknown[]) {
  const sent: Command[] = []
  const apply = async (c: Command): Promise<void> => {
    sent.push(c)
    const error = errors.shift()
    if (error) throw error
  }
  return { sent, apply }
}

describe('isUnknownOutcome and landedBefore', () => {
  it('only an unavailable source leaves the outcome unknown', () => {
    expect(isUnknownOutcome(lost)).toBe(true)
    expect(isUnknownOutcome(new StorageError('read_only'))).toBe(false)
    expect(isUnknownOutcome(new StorageError('failed'))).toBe(false)
    expect(isUnknownOutcome(new DomainError('insufficient_stock'))).toBe(false)
  })

  it('missing stock explains a retried use or move, nothing else', () => {
    const short = new DomainError('insufficient_stock')
    expect(landedBefore(use(), short)).toBe(true)
    expect(
      landedBefore({ type: 'stock.transfer', transferId: 't', outMovementId: 'o', inMovementId: 'n', itemId: 'i', fromVariantId: null, toVariantId: 'v', quantity: '1' }, short),
    ).toBe(true)
    expect(landedBefore(receive(), short)).toBe(false)
    expect(landedBefore(use(), new DomainError('archived'))).toBe(false)
    expect(landedBefore(use(), lost)).toBe(false)
  })
})

describe('createUnconfirmedSender', () => {
  it('a success leaves the form editing', async () => {
    const { sent, apply } = source()
    const sender = createUnconfirmedSender(apply)
    const command = receive()
    const sending = sender.send(command)
    expect([sender.phase.value, sender.busy.value, sender.frozen.value]).toEqual(['sending', true, false])
    expect(await sending).toBe('saved')
    expect(sent).toEqual([command])
    expect(sender.phase.value).toBe('editing')
    expect(sender.error.value).toBeNull()
  })

  it('a definite refusal keeps the form editing with the error', async () => {
    const refused = new DomainError('insufficient_stock')
    const sender = createUnconfirmedSender(source(refused).apply)
    expect(await sender.send(use())).toBe('failed')
    expect(sender.phase.value).toBe('editing')
    expect(sender.error.value).toBe(refused)
  })

  it('an unknown outcome of a relative or create command freezes the form; a retry sends the very same command', async () => {
    for (const command of [receive(), use(), create()]) {
      const { sent, apply } = source(lost)
      const sender = createUnconfirmedSender(apply)
      expect(await sender.send(command)).toBe('failed')
      expect(sender.phase.value).toBe('unconfirmed')
      expect([sender.frozen.value, sender.busy.value]).toEqual([true, false])
      expect(sender.error.value).toBe(lost)
      // Whatever the form builds now, the unconfirmed command is what goes out again.
      expect(await sender.send(receive())).toBe('saved')
      expect(sent).toEqual([command, command])
      expect(sender.phase.value).toBe('editing')
    }
  })

  it('an unknown outcome of a count leaves the form editing: its id follows the target instead', async () => {
    const sender = createUnconfirmedSender(source(lost).apply)
    expect(await sender.send(count('37'))).toBe('failed')
    expect(sender.phase.value).toBe('editing')
  })

  it('a retry that fails again in any way stays unconfirmed: the first attempt may still have landed', async () => {
    const offline = new StorageError('read_only')
    const { sent, apply } = source(lost, offline, lost)
    const sender = createUnconfirmedSender(apply)
    const command = receive()
    await sender.send(command)
    const retrying = sender.retry()
    expect(sender.phase.value).toBe('retrying')
    expect([sender.frozen.value, sender.busy.value]).toEqual([true, true])
    // Nothing else goes out meanwhile.
    expect(await sender.send(receive())).toBe('failed')
    expect(await retrying).toBe('failed')
    expect(sender.phase.value).toBe('unconfirmed')
    expect(sender.error.value).toBe(offline)
    expect(await sender.retry()).toBe('failed')
    expect(await sender.retry()).toBe('saved')
    expect(sent).toEqual([command, command, command, command])
  })

  it('a retried use refused for missing stock was probably saved the first time', async () => {
    const short = new DomainError('insufficient_stock')
    const sender = createUnconfirmedSender(source(lost, short).apply)
    await sender.send(use())
    expect(await sender.retry()).toBe('probablySaved')
    expect(sender.phase.value).toBe('editing')
  })

  it('a retry is saved without a write when the shown copy already holds the command', async () => {
    const { sent, apply } = source(lost)
    let loaded = false
    const command = create()
    const sender = createUnconfirmedSender(apply, (c) => loaded && c === command)
    await sender.send(command)
    loaded = true
    expect(await sender.retry()).toBe('saved')
    expect(sent).toEqual([command])
    expect(sender.phase.value).toBe('editing')
  })

  it('reset forgets the unconfirmed command; retry without one sends nothing', async () => {
    const { sent, apply } = source(lost)
    const sender = createUnconfirmedSender(apply)
    expect(await sender.retry()).toBe('failed')
    await sender.send(receive())
    sender.reset()
    expect(sender.phase.value).toBe('editing')
    expect(sender.error.value).toBeNull()
    expect(await sender.retry()).toBe('failed')
    expect(sent).toHaveLength(1)
  })
})

describe('payloadId', () => {
  it('keeps the id while the payload stays, and mints a new one when it changes', () => {
    const idFor = payloadId()
    const first = idFor('37')
    expect(idFor('37')).toBe(first)
    const second = idFor('38')
    expect(second).not.toBe(first)
    expect(idFor('37')).not.toBe(first)
    expect(payloadId()('37')).not.toBe(first)
  })
})
