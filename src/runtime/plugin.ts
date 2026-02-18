import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { io } from 'socket.io-client'
import type { RealtimeSocket } from './types'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  // Defaults to window.location.host if no socket url is provided
  const socket: RealtimeSocket = io(config.public.nuxtRealtime.socketUrl, {
    path: config.public.nuxtRealtime.socketPath || '/socket.io',
    autoConnect: true,
  })

  socket.on('connect', () => {
    console.log('Connected to realtime server')
  })

  return {
    provide: {
      realtimeSocket: socket,
    },
  }
})
