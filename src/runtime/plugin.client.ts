import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { io } from 'socket.io-client'
import type { RealtimeSocket } from './types'
import { useRealtimeLogger } from './composables/useRealtimeLogger'

export default defineNuxtPlugin<{ realtimeSocket: RealtimeSocket }>((nuxtApp) => {
  const config = useRuntimeConfig()
  const { socketUrl, socketPath, cleanup } = config.public.nuxtRealtime satisfies {
    socketUrl: string | undefined
    socketPath: string | undefined
    cleanup: { heartbeatInterval: number } | false
    logging: { level: string | undefined, format: string }
  }

  const logger = useRealtimeLogger()

  // Defaults to window.location.host if no socket url is provided
  const socket: RealtimeSocket = io(socketUrl, {
    path: socketPath || '/socket.io',
    autoConnect: true,
    // Re-invoked by socket.io-client on every (re)connection attempt, so a
    // registered `nuxt-realtime:auth` hook can supply a fresh/refreshed token
    // each time rather than one baked in at initial connect.
    auth: async (cb) => {
      const ctx = { auth: {} as Record<string, unknown> }
      try {
        await nuxtApp.hooks.callHook('nuxt-realtime:auth', ctx)
      }
      catch (error) {
        logger.error('nuxt-realtime:auth hook failed:', error)
      }
      cb(ctx.auth)
    },
  })

  socket.on('connect', () => {
    logger.debug('Connected to realtime server')
  })

  if (cleanup) {
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null

    const startHeartbeat = () => {
      if (heartbeatInterval !== null) return
      heartbeatInterval = setInterval(() => {
        socket.emit('storage:heartbeat')
      }, cleanup.heartbeatInterval)
    }

    const stopHeartbeat = () => {
      if (heartbeatInterval !== null) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
    }

    socket.on('connect', startHeartbeat)
    socket.on('disconnect', stopHeartbeat)

    if (socket.connected) {
      startHeartbeat()
    }
  }

  return {
    provide: {
      realtimeSocket: socket,
    },
  }
})
