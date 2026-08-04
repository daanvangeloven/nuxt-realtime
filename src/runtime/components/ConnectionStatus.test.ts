// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { ConnectionStatus as Status } from '../composables/useRealtimeConnection'
import ConnectionStatus from './ConnectionStatus.vue'

const status = ref<Status>('connected')

vi.mock('../composables/useRealtimeConnection', () => ({
  useRealtimeConnection: () => ({ status }),
}))
vi.mock('#app', () => ({
  useAppConfig: () => ({}),
}))

describe('ConnectionStatus', () => {
  it('shows the default label for the current status', () => {
    status.value = 'connected'
    const wrapper = mount(ConnectionStatus)

    expect(wrapper.text()).toBe('Connected')
  })

  it('reflects a status change', () => {
    status.value = 'reconnecting'
    const wrapper = mount(ConnectionStatus)

    expect(wrapper.text()).toBe('Reconnecting…')
  })

  it('lets labels be overridden, e.g. for i18n', () => {
    status.value = 'connected'
    const wrapper = mount(ConnectionStatus, { props: { labels: { connected: 'Verbonden' } } })

    expect(wrapper.text()).toBe('Verbonden')
  })

  it('leaves the other default labels intact when only overriding one', () => {
    status.value = 'disconnected'
    const wrapper = mount(ConnectionStatus, { props: { labels: { connected: 'Verbonden' } } })

    expect(wrapper.text()).toBe('Disconnected')
  })

  it('skips default classes when unstyled', () => {
    status.value = 'connected'
    const wrapper = mount(ConnectionStatus, { props: { unstyled: true } })

    expect(wrapper.find('span').classes()).toEqual([])
  })

  it('lets the default slot be overridden', () => {
    status.value = 'connected'
    const wrapper = mount(ConnectionStatus, {
      slots: { default: '<template #default="{ status }">{{ status }}!</template>' },
    })

    expect(wrapper.text()).toBe('connected!')
  })
})
