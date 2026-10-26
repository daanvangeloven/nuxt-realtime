import { describe, it, expect } from 'vitest'
import { createRateLimiter, isOriginAllowed, isReservedKey, isValidKey, isWithinSize, normalizeStorageKey, safeEqual } from './guards'

describe('normalizeStorageKey', () => {
  it.each([
    ['/_lock:x', '_lock:x'],
    [':_lock:x', '_lock:x'],
    ['\\_lock:x', '_lock:x'],
    ['a//b\\c', 'a:b:c'],
    ['a?_b', 'a'],
    ['a:b:', 'a:b'],
  ])('%p -> %p, matching unstorage', (input, expected) => {
    expect(normalizeStorageKey(input)).toBe(expected)
  })
})

describe('isReservedKey', () => {
  it.each(['_lock:x', '/_lock:x', '//_lock:x', ':_conn:x', '\\_lease:x', '?x', '/', '', 'x'.repeat(257), null, undefined, 42, {}])(
    'rejects %p',
    key => expect(isReservedKey(key)).toBe(true),
  )

  it.each(['chat', 'chat:room', '/chat/room', 'a_b', 'a:_b'])('allows %p', key => expect(isReservedKey(key)).toBe(false))
})

describe('isValidKey', () => {
  it('requires a non-empty string within the length cap', () => {
    expect(isValidKey('a')).toBe(true)
    expect(isValidKey('')).toBe(false)
    expect(isValidKey('x'.repeat(257))).toBe(false)
    expect(isValidKey(1)).toBe(false)
  })
})

describe('isWithinSize', () => {
  it('measures serialized bytes, not characters', () => {
    expect(isWithinSize('abc', 5)).toBe(true)
    expect(isWithinSize('abc', 4)).toBe(false)
    expect(isWithinSize('é', 4)).toBe(true)
    expect(isWithinSize(undefined, 0)).toBe(true)
  })
})

describe('safeEqual', () => {
  it('compares strings of any length without throwing', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})

describe('createRateLimiter', () => {
  it('allows `limit` calls per second then resets in the next window', () => {
    let now = 0
    const allow = createRateLimiter(2, () => now)
    expect([allow(), allow(), allow()]).toEqual([true, true, false])
    now = 1000
    expect(allow()).toBe(true)
  })

  it('is unlimited at 0', () => {
    const allow = createRateLimiter(0)
    expect(Array.from({ length: 1000 }, allow).every(Boolean)).toBe(true)
  })
})

describe('isOriginAllowed', () => {
  const req = (headers: Record<string, string>) => ({ headers })

  it('allows requests without an Origin header', () => {
    expect(isOriginAllowed(req({ host: 'app.test' }), undefined)).toBe(true)
  })

  it('defaults to same-origin, also behind a proxy that forwards the public host', () => {
    expect(isOriginAllowed(req({ host: 'app.test', origin: 'https://app.test' }), undefined)).toBe(true)
    expect(isOriginAllowed(req({ 'host': 'internal:3000', 'x-forwarded-host': 'app.test', 'origin': 'https://app.test' }), undefined)).toBe(true)
    expect(isOriginAllowed(req({ host: 'app.test', origin: 'https://evil.test' }), undefined)).toBe(false)
    expect(isOriginAllowed(req({ host: 'app.test', origin: 'not a url' }), undefined)).toBe(false)
  })

  it('matches configured cors.origin values', () => {
    const origin = 'https://app.test'
    expect(isOriginAllowed(req({ origin }), 'https://app.test')).toBe(true)
    expect(isOriginAllowed(req({ origin }), ['https://other.test', /app\.test$/])).toBe(true)
    expect(isOriginAllowed(req({ origin }), true)).toBe(true)
    expect(isOriginAllowed(req({ origin }), ['https://other.test'])).toBe(false)
    expect(isOriginAllowed(req({ origin: 'https://evil.test' }), 'https://app.test')).toBe(false)
  })
})
