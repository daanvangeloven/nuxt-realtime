<!-- eslint-disable vue/multi-word-component-names -->
<script setup lang="ts">
import type { ChatMessage } from './types'

const userId = crypto.randomUUID()
const chatInput = defineModel<string>()

const chatFeed = useRealtimeState<Array<ChatMessage>>('chat-feed', [], {
  optimisticUpdates: true,
})

function handleMessageSend() {
  if (chatInput.value) {
    chatFeed.value = [
      {
        message: chatInput.value,
        userId,
      },
      ...chatFeed.value,
    ]

    chatInput.value = ''
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UChatMessages>
      <UChatMessage
        v-for="(message, index) in chatFeed"
        :id="index.toString()"
        :key="index"
        :parts="[{
          type: 'text',
          id: index,
          text: message.message,
        }]"
        :side="message.userId === userId ? 'right' : 'left'"
        role="user"
        variant="soft"
      />
    </UChatMessages>

    <UChatPrompt
      v-model="chatInput"
      @submit="() => handleMessageSend()"
    />
  </div>
</template>
