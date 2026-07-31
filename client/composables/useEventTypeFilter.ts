import { EVENT_TYPES } from '../types'
import type { DevtoolsEventLogEntry, EventType } from '../types'

export interface UseEventTypeFilterReturn {
  activeTypes: ComputedRef<EventType[]>
  filteredEvents: ComputedRef<DevtoolsEventLogEntry[]>
  isAllActive: ComputedRef<boolean>
  setAll: (active: boolean) => void
  toggle: (type: EventType, active: boolean) => void
}

/**
 * Filters an event log down to a togglable set of active event types.
 * All types are active by default.
 *
 * @param events - The full (unfiltered) event log
 */
export function useEventTypeFilter(events: ComputedRef<DevtoolsEventLogEntry[]>): UseEventTypeFilterReturn {
  const active = shallowRef<EventType[]>([...EVENT_TYPES])

  function setAll(isActive: boolean): void {
    active.value = isActive ? [...EVENT_TYPES] : []
  }

  function toggle(type: EventType, isActive: boolean): void {
    active.value = isActive ? [...active.value, type] : active.value.filter(t => t !== type)
  }

  return {
    activeTypes: computed(() => active.value),
    filteredEvents: computed(() => events.value.filter(e => active.value.includes(e.type as EventType))),
    isAllActive: computed(() => active.value.length === EVENT_TYPES.length),
    setAll,
    toggle,
  }
}
