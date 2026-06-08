import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { io } from 'socket.io-client'
import type { RealtimeSocket } from './types'
import { useRealtimeLogger } from './composables/useRealtimeLogger'

export default defineNuxtPlugin<{ realtimeSocket: RealtimeSocket }>(() => {
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
