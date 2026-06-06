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
    logging: { level: string | null, format: string }
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
    setInterval(() => {
      socket.emit('storage:heartbeat')
    }, cleanup.heartbeatInterval)
  }

  return {
    provide: {
      realtimeSocket: socket,
    },
  }
})
