import { onUnmounted } from 'vue'
import { useNuxtApp } from '#imports'
import type { EventPublishResponse } from '../types'

export interface UseRealtimeEventsSubscribeOptions {
  /**
   * Whether to receive events that this client published
   *
   * @default false
   */
  includeSelf?: boolean
}

export interface UseRealtimeEventsOptions {
  /**
   * Timeout for publish acknowledgments in milliseconds
   *
   * @default 5000
   */
  publishTimeout?: number
}

export interface UseRealtimeEventsReturn {
  /**
   * Subscribe to an event channel
   *
   * @param channel - The channel name to subscribe to
   * @param callback - Callback function invoked when an event is received
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  subscribe: <T = unknown>(
    channel: string,
    callback: (data: T) => void,
    options?: UseRealtimeEventsSubscribeOptions,
  ) => () => void

  /**
   * Publish an event to a channel
   *
   * @param channel - The channel name to publish to
   * @param data - The event data to publish
   * @param options - Publish options
   * @returns Promise that resolves when the server acknowledges the event
   */
  publish: <T = unknown>(
    channel: string,
    data: T,
    options?: UseRealtimeEventsSubscribeOptions,
  ) => Promise<void>

  /**
   * Unsubscribe from an event channel
   *
   * @param channel - The channel name to unsubscribe from
   */
  unsubscribe: (channel: string) => void
}

export function useRealtimeEvents(options: UseRealtimeEventsOptions = {}): UseRealtimeEventsReturn {
  const { $realtimeSocket } = useNuxtApp()

  const { publishTimeout = 5000 } = options

  // Track subscriptions for cleanup
  const subscriptions = new Map<string, Map<(data: unknown) => void, { handler: (payload: unknown) => void, includeSelf: boolean }>>()

  const handleEventReceived = ({ channel, data }: { channel: string, data: unknown }) => {
    const channelSubs = subscriptions.get(channel)
    if (channelSubs) {
      for (const [callback] of channelSubs) {
        callback(data)
      }
    }
  }

  $realtimeSocket.on('event:received', handleEventReceived)

  const subscribe = <T = unknown>(
    channel: string,
    callback: (data: T) => void,
    subscribeOptions: UseRealtimeEventsSubscribeOptions = {},
  ): (() => void) => {
    const { includeSelf = false } = subscribeOptions

    // Get or create channel subscriptions map
    let channelSubs = subscriptions.get(channel)
    const isFirstSubscription = !channelSubs

    if (!channelSubs) {
      channelSubs = new Map()
      subscriptions.set(channel, channelSubs)
    }

    // Create a wrapped handler for this specific callback
    const handler = (data: unknown) => callback(data as T)

    channelSubs.set(callback as (data: unknown) => void, { handler, includeSelf })

    // Join the room if this is the first subscription to this channel
    if (isFirstSubscription) {
      $realtimeSocket.emit('event:subscribe', channel)
    }

    // Return unsubscribe function
    return () => {
      const subs = subscriptions.get(channel)
      if (subs) {
        subs.delete(callback as (data: unknown) => void)

        // If no more subscriptions for this channel, leave the room
        if (subs.size === 0) {
          subscriptions.delete(channel)
          $realtimeSocket.emit('event:unsubscribe', channel)
        }
      }
    }
  }

  const publish = <T = unknown>(
    channel: string,
    data: T,
    publishOptions: UseRealtimeEventsSubscribeOptions = {},
  ): Promise<void> => {
    const { includeSelf = false } = publishOptions

    return new Promise((resolve, reject) => {
      $realtimeSocket
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
    const channelSubs = subscriptions.get(channel)
    if (channelSubs) {
      subscriptions.delete(channel)
      $realtimeSocket.emit('event:unsubscribe', channel)
    }
  }

  // Cleanup on unmount
  onUnmounted(() => {
    // Remove the global event listener
    $realtimeSocket.off('event:received', handleEventReceived)

    // Unsubscribe from all channels
    for (const channel of subscriptions.keys()) {
      $realtimeSocket.emit('event:unsubscribe', channel)
    }
    subscriptions.clear()
  })

  return {
    subscribe,
    publish,
    unsubscribe,
  }
}
