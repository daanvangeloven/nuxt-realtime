import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export interface RealtimeLimits {
  /** Max length of a storage key, lock key, room id or event channel. */
  maxKeyLength: number
  /** Max JSON size in bytes of a storage value, lock `ownerInfo`, presence `info` or event `data`. */
  maxValueBytes: number
  /** Max subscribed rooms, and max distinct storage keys written, per socket. */
  maxKeysPerSocket: number
  /** Max events a single socket may emit per second. 0 disables the limit. */
  maxEventsPerSecond: number
}

export const DEFAULT_LIMITS: RealtimeLimits = {
  maxKeyLength: 256,
  maxValueBytes: 262_144,
  maxKeysPerSocket: 1000,
  maxEventsPerSecond: 120,
}

// Mirrors unstorage's normalizeKey. The driver normalizes after our checks run, so a key must be
// judged in its normalized form: `/_lock:x` and `_lock:x` address the same storage entry.
export function normalizeStorageKey(key: string): string {
  return key.split('?')[0]!.replace(/[/\\]/g, ':').replace(/:+/g, ':').replace(/^:|:$/g, '')
}

// The entire `_` prefix is reserved for module state. Judged on the normalized key.
export function isReservedKey(key: unknown, maxLength = DEFAULT_LIMITS.maxKeyLength): boolean {
  if (typeof key !== 'string' || key.length > maxLength) return true
  const normalized = normalizeStorageKey(key)
  return normalized.length === 0 || normalized.startsWith('_')
}

export function isValidKey(value: unknown, maxLength = DEFAULT_LIMITS.maxKeyLength): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

export function isWithinSize(value: unknown, maxBytes: number): boolean {
  if (value === undefined) return true
  try {
    const json = JSON.stringify(value)
    return json === undefined || Buffer.byteLength(json) <= maxBytes
  }
  catch {
    return false
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Fixed one-second window counter. Returns true while the caller is within `limit`. */
export function createRateLimiter(limit: number, now: () => number = Date.now): () => boolean {
  if (limit <= 0) return () => true
  let windowStart = now()
  let count = 0
  return () => {
    const t = now()
    if (t - windowStart >= 1000) {
      windowStart = t
      count = 0
    }
    return ++count <= limit
  }
}

type CorsOrigin = string | boolean | RegExp | Array<string | RegExp> | ((...args: never[]) => unknown) | undefined

function matchesOrigin(allowed: CorsOrigin, origin: string): boolean {
  if (allowed === true || allowed === '*') return true
  if (typeof allowed === 'string') return allowed === origin
  if (allowed instanceof RegExp) return allowed.test(origin)
  if (Array.isArray(allowed)) return allowed.some(entry => matchesOrigin(entry, origin))
  // A function-valued origin is evaluated by the host app's own cors setup; trust it.
  return typeof allowed === 'function'
}

/**
 * Cross-site WebSocket hijacking guard. Browsers always send `Origin` on WebSocket and
 * cross-origin XHR, and page scripts cannot forge it. Requests without one (non-browser
 * clients) are allowed. With no `cors.origin` configured only same-origin is accepted.
 */
export function isOriginAllowed(req: Pick<IncomingMessage, 'headers'>, corsOrigin: CorsOrigin): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  if (corsOrigin !== undefined && corsOrigin !== false) return matchesOrigin(corsOrigin, origin)

  let originHost: string
  try {
    originHost = new URL(origin).host
  }
  catch {
    return false
  }
  const forwarded = req.headers['x-forwarded-host']
  const hosts = [req.headers.host, ...(Array.isArray(forwarded) ? forwarded : forwarded?.split(',') ?? [])]
  return hosts.some(host => host?.trim() === originHost)
}
