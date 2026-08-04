import { computed, type ComputedRef } from 'vue'
import { useRealtimePresence } from './useRealtimePresence'

export interface UsePresenceAvatarOptions {
  /** Opaque room string */
  room: string
  /** `connectionId` of the member this avatar reflects. */
  connectionId: string
}

export interface PresenceAvatarInfo {
  name?: string
  avatarUrl?: string
}

export interface UsePresenceAvatarReturn {
  /** Opaque presence info for this member, or `undefined` if they're not present. */
  info: ComputedRef<PresenceAvatarInfo | undefined>
  /** Whether this `connectionId` is currently present in the room. */
  online: ComputedRef<boolean>
  /** Up to two-letter initials derived from `info.name`, for use as an image fallback. */
  initials: ComputedRef<string>
}

/**
 * Headless presence-avatar state: derives online status and display initials for one room
 * member from `useRealtimePresence`. Works natively with PresenceAvatar component.
 */
export function usePresenceAvatar<TInfo extends PresenceAvatarInfo = PresenceAvatarInfo>(options: UsePresenceAvatarOptions): UsePresenceAvatarReturn {
  const { members } = useRealtimePresence<TInfo>(options.room)

  const info = computed(() => members.value[options.connectionId])
  const online = computed(() => options.connectionId in members.value)
  const initials = computed(() => {
    const name = info.value?.name?.trim()
    if (!name) return ''
    const parts = name.split(/\s+/)
    return parts.length === 1
      ? parts[0]!.slice(0, 2).toUpperCase()
      : (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  })

  return { info, online, initials }
}
