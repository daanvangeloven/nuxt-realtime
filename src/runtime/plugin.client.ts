import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { io } from 'socket.io-client'
import { ref, type Ref } from 'vue'
import type { RealtimeSocket } from './types'
import { useRealtimeLogger } from './composables/useRealtimeLogger'

const CONNECTION_ID_STORAGE_KEY = 'nuxt-realtime:connectionId'

function generateId(): string {
  try {
    return crypto.randomUUID() // Throws on non https connection
  }
  catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }
}

// A stable id that survives reconnects
function getOrCreateConnectionId(): string {
  try {
    const existing = sessionStorage.getItem(CONNECTION_ID_STORAGE_KEY)
    if (existing) return existing
    const generated = generateId()
    sessionStorage.setItem(CONNECTION_ID_STORAGE_KEY, generated)
    return generated
  }
  catch {
    // fall back to an id that's stable for this page load only if sessionStorage is unavailable.
    return generateId()
  }
}

export default defineNuxtPlugin<{ realtimeSocket: RealtimeSocket, realtimeConnectionId: Ref<string> }>((nuxtApp) => {
  const config = useRuntimeConfig()
  const { socketUrl, socketPath, cleanup } = config.public.nuxtRealtime satisfies {
    socketUrl: string | undefined
    socketPath: string | undefined
    cleanup: { heartbeatInterval: number } | false
    logging: { level: string | undefined, format: string }
  }

  const logger = useRealtimeLogger()
  const connectionId = ref(getOrCreateConnectionId())

  // Defaults to window.location.host if no socket url is provided
  const socket: RealtimeSocket = io(socketUrl, {
    path: socketPath || '/socket.io',
    autoConnect: true,
    // Re-invoked by socket.io-client on every (re)connection attempt, so a
    // registered `nuxt-realtime:auth` hook can supply a fresh/refreshed token
    // each time rather than one baked in at initial connect.
    auth: async (cb) => {
      const ctx = { auth: { connectionId: connectionId.value } as Record<string, unknown> }
      try {
        await nuxtApp.hooks.callHook('nuxt-realtime:auth', ctx)
      }
      catch (error) {
        logger.error('nuxt-realtime:auth hook failed:', error)
      }
      if (typeof ctx.auth.connectionId === 'string') {
        connectionId.value = ctx.auth.connectionId
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
      realtimeConnectionId: connectionId,
    },
  }
})
