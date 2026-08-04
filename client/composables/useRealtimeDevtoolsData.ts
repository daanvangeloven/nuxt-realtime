import { useDevtoolsClient } from '@nuxt/devtools-kit/iframe-client'
import { appendEvents } from '../utils/events'
import type { ConnectionSummary, DevtoolsEventLogEntry, LockSnapshotEntry, PresenceSnapshotEntry, RealtimeRpc, RoomMembershipEntry, StorageSnapshotEntry } from '../types'

const RPC_NAMESPACE = 'nuxt-realtime'
const POLL_INTERVAL_MS = 1000
const MAX_LOG_ENTRIES = 500

export interface UseRealtimeDevtoolsDataReturn {
  connections: ComputedRef<ConnectionSummary[]>
  storage: ComputedRef<StorageSnapshotEntry[]>
  events: ComputedRef<DevtoolsEventLogEntry[]>
  locks: ComputedRef<LockSnapshotEntry[]>
  presence: ComputedRef<PresenceSnapshotEntry[]>
  roomMembers: ComputedRef<RoomMembershipEntry[]>
  error: ComputedRef<string | null>
}

/**
 * Polls the DevTools RPC server for connections, storage, the event log,
 * locks, presence, and room membership, merging each poll into local
 * reactive state.
 *
 * @returns Reactive snapshots of the last poll, plus the last poll error (if any)
 */
export function useRealtimeDevtoolsData(): UseRealtimeDevtoolsDataReturn {
  const client = useDevtoolsClient()
  const rpc = computed<RealtimeRpc | undefined>(() =>
    client.value?.devtools.extendClientRpc<RealtimeRpc, Record<string, never>>(RPC_NAMESPACE, {}),
  )

  const connections = shallowRef<ConnectionSummary[]>([])
  const storage = shallowRef<StorageSnapshotEntry[]>([])
  const events = shallowRef<DevtoolsEventLogEntry[]>([])
  const locks = shallowRef<LockSnapshotEntry[]>([])
  const presence = shallowRef<PresenceSnapshotEntry[]>([])
  const roomMembers = shallowRef<RoomMembershipEntry[]>([])
  const error = shallowRef<string | null>(null)
  let lastEventId = 0

  async function poll(): Promise<void> {
    const currentRpc = rpc.value
    if (!currentRpc) return

    try {
      const [nextConnections, nextStorage, newEvents, nextLocks, nextPresence, nextRoomMembers] = await Promise.all([
        currentRpc.getConnections(),
        currentRpc.getStorageSnapshot(),
        currentRpc.getEventLog(lastEventId),
        currentRpc.getLockSnapshot(),
        currentRpc.getPresenceOverview(),
        currentRpc.getRoomMembershipSnapshot(),
      ])

      connections.value = nextConnections
      storage.value = nextStorage
      locks.value = nextLocks
      presence.value = nextPresence
      roomMembers.value = nextRoomMembers

      if (newEvents.length > 0) {
        const merged = appendEvents({ existing: events.value, incoming: newEvents, lastId: lastEventId, maxEntries: MAX_LOG_ENTRIES })
        events.value = merged.events
        lastEventId = merged.lastId
      }

      error.value = null
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  // immediateCallback: matches the original setInterval(poll, ...) + eager poll() on mount
  useIntervalFn(poll, POLL_INTERVAL_MS, { immediateCallback: true })

  return {
    connections: computed(() => connections.value),
    storage: computed(() => storage.value),
    events: computed(() => events.value),
    locks: computed(() => locks.value),
    presence: computed(() => presence.value),
    roomMembers: computed(() => roomMembers.value),
    error: computed(() => error.value),
  }
}
