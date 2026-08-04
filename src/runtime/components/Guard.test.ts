// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import Guard from './Guard.vue'

const connected = ref(true)

vi.mock('../composables/useRealtimeConnection', () => ({
  useRealtimeConnection: () => ({ connected }),
}))

describe('Guard', () => {
  it('renders the default slot while connected', () => {
    connected.value = true
    const wrapper = mount(Guard, { slots: { default: 'Online', fallback: 'Offline' } })

    expect(wrapper.text()).toBe('Online')
  })

  it('renders the fallback slot while disconnected', () => {
    connected.value = false
    const wrapper = mount(Guard, { slots: { default: 'Online', fallback: 'Offline' } })

    expect(wrapper.text()).toBe('Offline')
  })

  it('renders nothing when disconnected and no fallback slot is given', () => {
    connected.value = false
    const wrapper = mount(Guard, { slots: { default: 'Online' } })

    expect(wrapper.text()).toBe('')
  })
})
