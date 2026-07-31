import { describe, it, expect, vi } from 'vitest'
import { Redis } from 'ioredis'
import { RealtimePubSub } from './redis'

vi.mock('ioredis', () => {
  function client() {
    return { on: vi.fn(), publish: vi.fn(), subscribe: vi.fn(), disconnect: vi.fn() }
  }
  const RedisMock = Object.assign(vi.fn(client), { Cluster: vi.fn(client) })
  return { Redis: RedisMock }
})

describe('RealtimePubSub cluster support', () => {
  it('constructs Redis.Cluster and ignores url/host/port when cluster is set', () => {
    const cluster = [{ host: 'redis-1', port: 6379 }]
    new RealtimePubSub({ cluster, url: 'redis://ignored', host: 'ignored', port: 1234 })

    expect(Redis.Cluster).toHaveBeenCalledTimes(2) // pub + sub connections
    expect(Redis.Cluster).toHaveBeenCalledWith(cluster, undefined)
    expect(Redis).not.toHaveBeenCalled()
  })
})
