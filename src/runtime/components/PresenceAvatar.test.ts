// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import PresenceAvatar from './PresenceAvatar.vue'

interface Info { name?: string, avatarUrl?: string }

const info = ref<Info | undefined>(undefined)
const online = ref(false)
const initials = computed(() => {
  const name = info.value?.name?.trim()
  if (!name) return ''
  const parts = name.split(/\s+/)
  return parts.length === 1
    ? parts[0]!.slice(0, 2).toUpperCase()
    : (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
})

vi.mock('../composables/usePresenceAvatar', () => ({
  usePresenceAvatar: () => ({ info, online, initials }),
}))
vi.mock('#app', () => ({
  useAppConfig: () => ({}),
}))

describe('PresenceAvatar', () => {
  const props = { room: 'project-42', connectionId: 'bob' }

  it('shows initials when there is no avatar image', () => {
    info.value = { name: 'Ada Lovelace' }
    online.value = true
    const wrapper = mount(PresenceAvatar, { props })

    expect(wrapper.text()).toBe('AL')
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('shows the avatar image when info has one', () => {
    info.value = { name: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' }
    online.value = true
    const wrapper = mount(PresenceAvatar, { props })

    expect(wrapper.find('img').attributes('src')).toBe('https://example.com/a.png')
    expect(wrapper.find('img').attributes('alt')).toBe('Ada Lovelace')
  })

  it('only renders the online dot while online', () => {
    info.value = { name: 'Ada Lovelace' }
    online.value = false
    const offline = mount(PresenceAvatar, { props })
    expect(offline.element.children).toHaveLength(1)

    online.value = true
    const wrapperOnline = mount(PresenceAvatar, { props })
    expect(wrapperOnline.element.children).toHaveLength(2)
  })

  it('skips default classes when unstyled', () => {
    info.value = { name: 'Ada Lovelace' }
    online.value = true
    const wrapper = mount(PresenceAvatar, { props: { ...props, unstyled: true } })

    expect(wrapper.find('span').classes()).toEqual([])
  })
})
