// Composite internal keys look like `_presence:{room}:{connectionId}` and are listed by prefix.
// Ids are client-supplied and may contain `:`, so the segment a prefix scan is anchored on is
// encoded: otherwise room `a` would list the members/locks of room `a:b`.
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment)
}
