<script setup lang="ts">
import { computed } from 'vue'
import { useAppConfig } from '#app'
import { useRealtimeConnection, type ConnectionStatus } from '../composables/useRealtimeConnection'
import { tv } from '../theme/tv'
import theme from '../theme/connection-status'

const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg'
  /** Skip applying default classes entirely */
  unstyled?: boolean
  /** Override the default English labels, e.g. with i18n translations. */
  labels?: Partial<Record<ConnectionStatus, string>>
}>(), {
  size: 'md',
  unstyled: false,
})

const { status } = useRealtimeConnection()

const defaultLabels: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  disconnected: 'Disconnected',
}

const labels = computed<Record<ConnectionStatus, string>>(() => ({ ...defaultLabels, ...props.labels }))

const appConfig = useAppConfig() as { realtimeUi?: { connectionStatus?: Record<string, unknown> } }
const noop = () => undefined
const unstyledUi = { root: noop, dot: noop, label: noop }
const ui = computed(() =>
  props.unstyled
    ? unstyledUi
    : tv({ extend: tv(theme), ...(appConfig.realtimeUi?.connectionStatus ?? {}) })({ size: props.size, status: status.value }),
)
</script>

<template>
  <span :class="ui.root()">
    <span :class="ui.dot()" />
    <slot :status="status">
      <span :class="ui.label()">{{ labels[status] }}</span>
    </slot>
  </span>
</template>
