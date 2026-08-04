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

    const [connectionsResult, storageResult, eventsResult, locksResult, presenceResult, roomMembersResult] = await Promise.allSettled([
      currentRpc.getConnections(),
      currentRpc.getStorageSnapshot(),
      currentRpc.getEventLog(lastEventId),
      currentRpc.getLockSnapshot(),
      currentRpc.getPresenceOverview(),
      currentRpc.getRoomMembershipSnapshot(),
    ])

    if (connectionsResult.status === 'fulfilled') connections.value = connectionsResult.value
    if (storageResult.status === 'fulfilled') storage.value = storageResult.value
    if (locksResult.status === 'fulfilled') locks.value = locksResult.value
    if (presenceResult.status === 'fulfilled') presence.value = presenceResult.value
    if (roomMembersResult.status === 'fulfilled') roomMembers.value = roomMembersResult.value

    if (eventsResult.status === 'fulfilled' && eventsResult.value.length > 0) {
      const merged = appendEvents({ existing: events.value, incoming: eventsResult.value, lastId: lastEventId, maxEntries: MAX_LOG_ENTRIES })
      events.value = merged.events
      lastEventId = merged.lastId
    }

    const failed = [connectionsResult, storageResult, eventsResult, locksResult, presenceResult, roomMembersResult].find(r => r.status === 'rejected')
    error.value = failed ? (failed.reason instanceof Error ? failed.reason.message : String(failed.reason)) : null
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
