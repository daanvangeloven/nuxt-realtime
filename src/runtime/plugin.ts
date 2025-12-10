import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { io } from 'socket.io-client'

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  const socket = io(config.public.nuxtRealtime.socketUrl || '', {
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
