<script setup lang="ts">
const search = ref('')
const { connections, storage, events, locks, presence, roomMembers, error } = useRealtimeDevtoolsData()
const { selectedConnectionId, selectedConnection, select, clear } = useConnectionSelection(connections)
</script>

<template>
  <NSplitPane
    storage-key="devtools:nuxt-realtime"
    class="!h-screen"
    :min-size="30"
  >
    <template #left>
      <NNavbar v-model:search="search">
        <template #actions>
          <div class="text-xs op-40">
            {{ connections.length }} connection{{ connections.length === 1 ? '' : 's' }}
          </div>
        </template>
      </NNavbar>

      <div
        v-if="error"
        class="p-4 text-red-500 text-sm"
      >
        {{ error }}
      </div>

      <ConnectionList
        :connections="connections"
        :search="search"
        :selected-id="selectedConnectionId"
        @select="select"
      />

      <StoragePanel :entries="storage" />

      <LocksPanel :entries="locks" />

      <PresencePanel :entries="presence" />

      <RoomsPanel :entries="roomMembers" />

      <EventLogPanel :events="events" />
    </template>

    <template
      #right
    >
      <ConnectionDetailPanel
        v-if="selectedConnection"
        :connection="selectedConnection"
        @close="clear"
      />
      <div
        v-else
        class="h-full flex flex-col items-center justify-center gap-1 text-sm op-40"
      >
        <div>No connection selected.</div>
        <div>Select a connection to see detailed information</div>
      </div>
    </template>
  </NSplitPane>
</template>
