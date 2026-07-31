import { describe, it, expect } from 'vitest'
import { appendEvents } from './events'
import type { DevtoolsEventLogEntry } from '../types'

function entry(id: number): DevtoolsEventLogEntry {
  return { id, type: 'connect', socketId: `socket-${id}`, timestamp: id }
}

describe('appendEvents', () => {
  it('prepends incoming events, newest first', () => {
    const result = appendEvents({
      existing: [entry(1)],
      incoming: [entry(3), entry(2)],
      lastId: 1,
      maxEntries: 10,
    })

    expect(result.events.map(e => e.id)).toEqual([3, 2, 1])
  })

  it('caps the merged log at maxEntries, dropping the oldest', () => {
    const result = appendEvents({
      existing: [entry(2), entry(1)],
      incoming: [entry(3)],
      lastId: 2,
      maxEntries: 2,
    })

    expect(result.events.map(e => e.id)).toEqual([3, 2])
  })

  it('advances lastId to the highest incoming id', () => {
    const result = appendEvents({
      existing: [],
      incoming: [entry(4), entry(5)],
      lastId: 3,
      maxEntries: 10,
    })

    expect(result.lastId).toBe(5)
  })

  it('keeps lastId unchanged when incoming is empty', () => {
    const result = appendEvents({
      existing: [entry(1)],
      incoming: [],
      lastId: 1,
      maxEntries: 10,
    })

    expect(result.events).toEqual([entry(1)])
    expect(result.lastId).toBe(1)
  })
})
