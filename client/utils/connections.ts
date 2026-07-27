import type { ConnectionSummary } from '../types'

export function filterConnections(connections: ConnectionSummary[], query: string): ConnectionSummary[] {
  const q = query.toLowerCase()
  return connections.filter(c => c.id.toLowerCase().includes(q) || c.address.includes(query))
}
