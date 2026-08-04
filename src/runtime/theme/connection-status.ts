/**
 * Colors are wired to Nuxt UI's structural CSS vars (`--ui-*`) with literal fallbacks, so this
 * renders sanely with zero Nuxt UI present. The status dot uses library-owned `--rt-*` vars
 * (matching presence-avatar's `--rt-online`) rather than `--ui-*` tokens, which aren't stable
 * static values — set `--rt-online`/`--rt-pending`/`--rt-offline` in your own CSS to match your
 * palette exactly.
 */
export default {
  slots: {
    root: 'inline-flex items-center gap-1.5 text-(--ui-text,#374151)',
    dot: 'rounded-full shrink-0',
    label: '',
  },
  variants: {
    size: {
      sm: { root: 'text-xs', dot: 'size-1.5' },
      md: { root: 'text-sm', dot: 'size-2' },
      lg: { root: 'text-base', dot: 'size-2.5' },
    },
    status: {
      connected: { dot: 'bg-(--rt-online,#22c55e)' },
      connecting: { dot: 'bg-(--rt-pending,#eab308)' },
      reconnecting: { dot: 'bg-(--rt-pending,#eab308)' },
      disconnected: { dot: 'bg-(--rt-offline,#9ca3af)' },
    },
  },
  defaultVariants: {
    size: 'md',
  },
} as const
