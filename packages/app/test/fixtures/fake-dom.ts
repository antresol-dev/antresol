/*
 * The little of the DOM that lib/styles/apply.ts touches (the tests run in node): a document with <head>, elements with
 * an id and text, replaceWith, and an <html> whose attributes and inline style are recorded.
 */

export interface FakeElement {
  tagName: string
  id: string
  textContent: string
  parent: FakeElement[] | null
  replaceWith(next: FakeElement): void
}

export interface FakeRoot {
  /** Pass as the root element. */
  el: HTMLElement
  /** <head>'s children. */
  head: FakeElement[]
  attributes: Map<string, string>
  /** Inline style properties set on the root. */
  inline: Map<string, string>
}

/** `existing`: what <head> already holds (a stylesheet link, other style elements). */
export function fakeRoot(existing: { tagName: string; id?: string; textContent?: string }[] = []): FakeRoot {
  const head: FakeElement[] = []
  const attributes = new Map<string, string>()
  const inline = new Map<string, string>()
  const createElement = (tagName: string): FakeElement => {
    const el: FakeElement = {
      tagName: tagName.toUpperCase(),
      id: '',
      textContent: '',
      parent: null,
      replaceWith(next) {
        const list = el.parent!
        list.splice(list.indexOf(el), 1, next)
        next.parent = list
        el.parent = null
      },
    }
    return el
  }
  for (const e of existing) {
    const el = createElement(e.tagName)
    el.id = e.id ?? ''
    el.textContent = e.textContent ?? ''
    el.parent = head
    head.push(el)
  }
  const doc = {
    head: {
      append(el: FakeElement) {
        head.push(el)
        el.parent = head
      },
    },
    createElement,
    getElementById: (id: string) => head.find((e) => e.id === id) ?? null,
  }
  const el = {
    ownerDocument: doc,
    setAttribute: (k: string, v: string) => void attributes.set(k, v),
    getAttribute: (k: string) => attributes.get(k) ?? null,
    style: { setProperty: (k: string, v: string) => void inline.set(k, v) },
  } as unknown as HTMLElement
  return { el, head, attributes, inline }
}
