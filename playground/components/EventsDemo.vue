<script setup lang="ts">
interface Notification {
  title: string
  description: string
  color: 'success' | 'info' | 'warning' | 'error'
}

const toast = useToast()
const { subscribe, publish } = useRealtimeEvents()

subscribe<Notification>('notifications', (notification) => {
  toast.add({
    title: notification.title,
    description: notification.description,
    color: notification.color,
  })
})

async function sendNotification(notification: Notification) {
  await publish('notifications', notification)
}
</script>

<template>
  <div class="border rounded-lg p-4">
    <h2 class="text-lg font-bold mb-4">
      Realtime Events Demo
    </h2>
    <p class="text-gray-500 text-sm mb-4">
      Click a button to broadcast a notification to all other connected clients.
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton
        color="success"
        @click="sendNotification({
          title: 'Success!',
          description: 'Something good happened on another client.',
          color: 'success',
        })"
      >
        Send Success
      </UButton>
      <UButton
        color="info"
        @click="sendNotification({
          title: 'Info',
          description: 'Here is some information from another client.',
          color: 'info',
        })"
      >
        Send Info
      </UButton>
      <UButton
        color="warning"
        @click="sendNotification({
          title: 'Warning',
          description: 'A warning from another client.',
          color: 'warning',
        })"
      >
        Send Warning
      </UButton>
      <UButton
        color="error"
        @click="sendNotification({
          title: 'Error',
          description: 'An error occurred on another client.',
          color: 'error',
        })"
      >
        Send Error
      </UButton>
    </div>
  </div>
</template>
