import { defineNuxtPlugin, useRuntimeConfig } from '#imports'
import { io } from 'socket.io-client'
import { createConsola, LogLevels } from 'consola'
import type { RealtimeSocket } from './types'

const LOG_LEVEL_MAP: Record<string, number> = {
  debug: LogLevels.debug,
  info: LogLevels.info,
  warn: LogLevels.warn,
  error: LogLevels.error,
  silent: LogLevels.silent,
}

export default defineNuxtPlugin((): { provide: { realtimeSocket: RealtimeSocket } } => {
  const config = useRuntimeConfig()
  const { socketUrl, socketPath, cleanup, logging } = config.public.nuxtRealtime as {
    socketUrl: string | undefined
    socketPath: string | undefined
    cleanup: { heartbeatInterval: number } | false
    logging: { level: string | null, format: string }
  }

  const resolvedLevel = (logging.level && logging.level in LOG_LEVEL_MAP)
    ? LOG_LEVEL_MAP[logging.level]
    : (import.meta.dev ? LogLevels.debug : LogLevels.warn)
  const logger = createConsola({ level: resolvedLevel }).withTag('nuxt-realtime')

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
