import { uuidv7 } from 'uuidv7'

export type Id = string

export function newId(): Id {
  return uuidv7()
}
