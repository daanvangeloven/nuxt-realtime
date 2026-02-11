import { useNuxtApp } from '#imports'
import type { Socket } from 'socket.io-client'
import { onUnmounted, ref, type Ref } from 'vue'

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'reconnecting'

export interface UseRealtimeConnectionOptions {
  onConnected?: () => void
  onDisconnected?: (reason: string) => void
  onReconnecting?: (attempt: number) => void
  onReconnected?: (attempt: number) => void
  onReconnectFailed?: () => void
  onError?: (error: Error) => void
}

export interface UseRealtimeConnectionReturn {
  // Reactive state
  connected: Readonly<Ref<boolean>>
  status: Readonly<Ref<ConnectionStatus>>
  attempt: Readonly<Ref<number | undefined>>

  // Methods
  connect: () => void
  disconnect: () => void

  // Raw socket
  socket: Socket
}

export function useRealtimeConnection(options: UseRealtimeConnectionOptions = {}): UseRealtimeConnectionReturn {
  const { $realtimeSocket: socket } = useNuxtApp()
  const manager = socket.io

  // State
  const connected = ref<boolean>(socket.connected)
  const status = ref<ConnectionStatus>(connected.value ? 'connected' : 'connecting')
  const attempt = ref<number | undefined>(undefined)

  // Socket event handlers
  const onConnect = () => {
    connected.value = true
    status.value = 'connected'
    options.onConnected?.()
  }
  const onDisconnect = (reason: Socket.DisconnectReason) => {
    connected.value = false
    status.value = 'disconnected'
    options.onDisconnected?.(reason)
  }
  const onConnectError = (error: Error) => options.onError?.(error)

  // Manager event handlers
  const onReconnectFailed = () => options.onReconnectFailed?.()
  const onReconnectError = (error: Error) => options.onError?.(error)
  const onReconnect = (attemptNumber: number) => {
    attempt.value = undefined
    status.value = 'connected'
    options.onReconnected?.(attemptNumber)
  }
  const onReconnectAttempt = (attemptNumber: number) => {
    attempt.value = attemptNumber
    status.value = 'reconnecting'
    options.onReconnecting?.(attemptNumber)
  }

  // Register socket events
  socket.on('connect', onConnect)
  socket.on('disconnect', onDisconnect)
  socket.on('connect_error', onConnectError)

  // Register manager events
  manager.on('reconnect_failed', onReconnectFailed)
  manager.on('reconnect_error', onReconnectError)
  manager.on('reconnect', onReconnect)
  manager.on('reconnect_attempt', onReconnectAttempt)

  onUnmounted(() => {
    socket.off('connect', onConnect)
    socket.off('disconnect', onDisconnect)
    socket.off('connect_error', onConnectError)

    manager.off('reconnect_failed', onReconnectFailed)
    manager.off('reconnect_error', onReconnectError)
    manager.off('reconnect', onReconnect)
    manager.off('reconnect_attempt', onReconnectAttempt)
  })

  return {
    connected,
    status,
    attempt,

    connect: () => socket.connect(),
    disconnect: () => socket.disconnect(),

    socket,
  }
}
