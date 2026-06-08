import { onUnmounted } from 'vue'
import { useNuxtApp } from '#app'
import type { EventPublishResponse } from '../types'

export interface UseRealtimeEventsSubscribeOptions {
  /**
   * Whether to receive events that this client published
   *
   * @default false
   */
  includeSelf?: boolean
}

/**
 * Middleware function for intercepting and transforming events before they reach subscribers.
 * Call `next()` to continue processing; omit the call to block the event.
 *
 * @example
 * const loggingMiddleware: EventMiddleware = (event, next) => {
 *   console.log('Event received:', event.channel, event.data)
 *   next()
 * }
 */
export type EventMiddleware = (
  event: { channel: string, data: unknown },
  next: () => void,
) => void

export interface UseRealtimeEventsOptions {
  /**
   * Timeout for publish acknowledgments in milliseconds
   *
   * @default 5000
   */
  publishTimeout?: number

  /**
   * Middleware functions applied to every incoming event before subscribers are called.
   * Each middleware receives the mutable event object and a `next` function.
   * Mutate `event.data` to transform the payload; omit calling `next()` to block the event.
   *
   * @example
   * middleware: [
   *   (event, next) => {
   *     if (isValid(event.data)) next()
   *   },
   *   (event, next) => {
   *     event.data = transform(event.data)
   *     next()
   *   }
   * ]
   */
  middleware?: EventMiddleware[]
}

/**
 * Return type of `useRealtimeEvents`.
 *
 * The optional `TEventMap` generic constrains `publish` and `subscribe` to known
 * channel names and their associated payload types.
 *
 * @example
 * interface ChatEvents {
 *   'chat:message': { text: string; userId: string }
 *   'chat:typing': { userId: string }
 * }
 * const { publish, subscribe } = useRealtimeEvents<ChatEvents>()
 * publish('chat:message', { text: 'Hello', userId: '1' })  // typed ✓
 * publish('chat:message', { text: 'Hello' })               // type error ✗
 */
export interface UseRealtimeEventsReturn<TEventMap = Record<string, unknown>> {
  /**
   * Subscribe to a channel or wildcard pattern.
   *
   * Supports exact channels (`'chat:message'`), namespace wildcards (`'chat:*'`),
   * and the global wildcard (`'*'`). The callback receives the event data and,
   * as an optional second argument, the actual channel name — useful when using
   * wildcard patterns.
   *
   * @returns An unsubscribe function
   */
  subscribe: <K extends string & (keyof TEventMap | `${string}:*` | '*')>(
    channel: K,
    callback: (
      data: K extends keyof TEventMap ? TEventMap[K] : unknown,
      actualChannel?: string,
    ) => void,
    options?: UseRealtimeEventsSubscribeOptions,
  ) => () => void

  /**
   * Publish an event to a channel.
   *
   * @returns Promise that resolves when the server acknowledges the event
   */
  publish: <K extends string & keyof TEventMap>(
    channel: K,
    data: TEventMap[K],
    options?: UseRealtimeEventsSubscribeOptions,
  ) => Promise<void>

  /**
   * Unsubscribe all callbacks from a channel.
   */
  unsubscribe: (channel: string) => void
}

type SubscriberCallback = (data: unknown, actualChannel?: string) => void

/**
 * Returns true when `pattern` is a wildcard that matches `channel`.
 * Supports global wildcard (`*`) and namespace wildcards (`namespace:*`).
 * A namespace wildcard matches any channel that starts with the prefix,
 * e.g. `chat:*` matches `chat:message`, `chat:typing`, and `chat:room:message`.
 */
function matchesWildcard(pattern: string, channel: string): boolean {
  if (pattern === '*') return true
  if (pattern.endsWith(':*')) {
    return channel.startsWith(pattern.slice(0, -1)) // 'chat:' from 'chat:*'
  }
  return false
}

function runMiddleware(
  event: { channel: string, data: unknown },
  middlewares: EventMiddleware[],
  final: () => void,
): void {
  if (middlewares.length === 0) {
    final()
    return
  }
  let index = 0
  const next = () => {
    if (index < middlewares.length) {
      middlewares[index++](event, next)
    }
    else {
      final()
    }
  }
  next()
}

export function useRealtimeEvents<TEventMap = Record<string, unknown>>(
  options: UseRealtimeEventsOptions = {},
): UseRealtimeEventsReturn<TEventMap> {
  const socket = import.meta.client ? useNuxtApp().$realtimeSocket : null

  const { publishTimeout = 5000, middleware = [] } = options

  const subscriptions = new Map<string, Set<SubscriberCallback>>()

  const handleEventReceived = ({ channel, data }: { channel: string, data: unknown }) => {
    // Collect all callbacks that should fire: exact match + any wildcard patterns.
    // Wildcards are matched client-side; deduplication of the incoming event itself
    // is handled server-side via Socket.IO's multi-room array broadcast.
    const callbacks: SubscriberCallback[] = []

    for (const [pattern, patternSubs] of subscriptions) {
      if (pattern === channel || matchesWildcard(pattern, channel)) {
        for (const cb of patternSubs) callbacks.push(cb)
      }
    }

    if (callbacks.length === 0) return

    const event = { channel, data }
    runMiddleware(event, middleware, () => {
      for (const cb of callbacks) {
        cb(event.data, event.channel)
      }
    })
  }

  if (socket) {
    socket.on('event:received', handleEventReceived)
  }

  const subscribe = <K extends string>(
    channel: K,
    callback: (data: unknown, actualChannel?: string) => void,
    _subscribeOptions: UseRealtimeEventsSubscribeOptions = {},
  ): (() => void) => {
    if (!socket) return () => {}

    let channelSubs = subscriptions.get(channel)
    const isFirstSubscription = !channelSubs

    if (!channelSubs) {
      channelSubs = new Set()
      subscriptions.set(channel, channelSubs)
    }

    const cb = callback as SubscriberCallback
    channelSubs.add(cb)

    if (isFirstSubscription) {
      socket.emit('event:subscribe', channel)
    }

    return () => {
      const subs = subscriptions.get(channel)
      if (subs) {
        subs.delete(cb)
        if (subs.size === 0) {
          subscriptions.delete(channel)
          socket.emit('event:unsubscribe', channel)
        }
      }
    }
  }

  const publish = (
    channel: string,
    data: unknown,
    publishOptions: UseRealtimeEventsSubscribeOptions = {},
  ): Promise<void> => {
    if (!socket) return Promise.resolve()

    const { includeSelf = false } = publishOptions

    return new Promise((resolve, reject) => {
      socket
        .timeout(publishTimeout)
        .emit(
          'event:publish',
          { channel, data, includeSelf },
          (err: Error, response: EventPublishResponse) => {
            if (err) {
              reject(new Error(`Publish timeout: ${err}`))
            }
            else if (!response?.success) {
              reject(new Error(response?.error || 'Failed to publish event'))
            }
            else {
              resolve()
            }
          },
        )
    })
  }

  const unsubscribe = (channel: string): void => {
    if (!socket) return
    const channelSubs = subscriptions.get(channel)
    if (channelSubs) {
      subscriptions.delete(channel)
      socket.emit('event:unsubscribe', channel)
    }
  }

  onUnmounted(() => {
    if (!socket) return

    socket.off('event:received', handleEventReceived)

    for (const channel of subscriptions.keys()) {
      socket.emit('event:unsubscribe', channel)
    }
    subscriptions.clear()
  })

  return {
    subscribe,
    publish,
    unsubscribe,
  } as unknown as UseRealtimeEventsReturn<TEventMap>
}
