<script setup lang="ts">
import { computed } from 'vue'
import { useAppConfig } from '#app'
import { usePresenceAvatar } from '../composables/usePresenceAvatar'
import { tv } from '../theme/tv'
import theme from '../theme/presence-avatar'

const props = withDefaults(defineProps<{
  /** Opaque room string, same as `useRealtimePresence`'s `room` argument. */
  room: string
  /** `connectionId` of the member this avatar reflects. */
  connectionId: string
  size?: 'sm' | 'md' | 'lg'
  /** Skip applying default classes entirely */
  unstyled?: boolean
}>(), {
  size: 'md',
  unstyled: false,
})

const { info, online, initials } = usePresenceAvatar({ room: props.room, connectionId: props.connectionId })

const appConfig = useAppConfig() as { realtimeUi?: { presenceAvatar?: Record<string, unknown> } }
const noop = () => undefined
const unstyledUi = { root: noop, content: noop, image: noop, fallback: noop, dot: noop }
const ui = computed(() =>
  props.unstyled
    ? unstyledUi
    : tv({ extend: tv(theme), ...(appConfig.realtimeUi?.presenceAvatar ?? {}) })({ size: props.size }),
)
</script>

<template>
  <span :class="ui.root()">
    <span :class="ui.content()">
      <img
        v-if="info?.avatarUrl"
        :src="info.avatarUrl"
        :alt="info?.name ?? connectionId"
        :class="ui.image()"
      >
      <span
        v-else
        :class="ui.fallback()"
      >{{ initials }}</span>
    </span>
    <span
      v-if="online"
      :class="ui.dot()"
    />
  </span>
</template>
