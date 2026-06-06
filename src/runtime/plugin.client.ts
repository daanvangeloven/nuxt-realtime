import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { io } from 'socket.io-client'
import type { RealtimeSocket } from './types'

export default defineNuxtPlugin<{ realtimeSocket: RealtimeSocket }>(() => {
  const config = useRuntimeConfig()
  const { socketUrl, socketPath, cleanup } = config.public.nuxtRealtime as {
    socketUrl: string | undefined
    socketPath: string | undefined
    cleanup: { heartbeatInterval: number } | false
  }

  // Defaults to window.location.host if no socket url is provided
  const socket: RealtimeSocket = io(socketUrl, {
    path: socketPath || '/socket.io',
    autoConnect: true,
  })

  socket.on('connect', () => {
    console.log('Connected to realtime server')
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
