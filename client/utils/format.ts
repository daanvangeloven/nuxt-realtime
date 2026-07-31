export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}
