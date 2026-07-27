import type { ConnectionSummary } from '../types'

export interface UseConnectionSelectionReturn {
  selectedConnectionId: ComputedRef<string | null>
  selectedConnection: ComputedRef<ConnectionSummary | null>
  select: (id: string) => void
  clear: () => void
}

/**
 * Tracks which connection is selected, clearing the selection automatically
 * once it drops out of the (reactive) connections list.
 *
 * @param connections - The current connection list
 */
export function useConnectionSelection(connections: ComputedRef<ConnectionSummary[]>): UseConnectionSelectionReturn {
  const selectedId = shallowRef<string | null>(null)

  const selectedConnection = computed(() =>
    connections.value.find(c => c.id === selectedId.value) ?? null,
  )

  watch(connections, (next) => {
    if (selectedId.value && !next.some(c => c.id === selectedId.value)) {
      selectedId.value = null
    }
  })

  function select(id: string): void {
    selectedId.value = id
  }

  function clear(): void {
    selectedId.value = null
  }

  return {
    selectedConnectionId: computed(() => selectedId.value),
    selectedConnection,
    select,
    clear,
  }
}
