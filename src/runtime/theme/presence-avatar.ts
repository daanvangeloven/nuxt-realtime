/**
 * Colors are wired to Nuxt UI's structural CSS vars (`--ui-*`) with literal fallbacks, so
 * this renders sanely with zero Nuxt UI present. The online dot uses a library-owned
 * `--rt-online` var rather than `--ui-primary`, which isn't a stable static token (it's
 * assembled per-project at Nuxt UI build time) — set `--rt-online: var(--ui-primary)` in your
 * own CSS for exact color parity with Nuxt UI's primary color.
 */
export default {
  slots: {
    root: 'relative inline-flex items-center justify-center shrink-0',
    content: 'flex items-center justify-center w-full h-full rounded-full overflow-hidden bg-(--ui-bg-elevated,#e5e7eb) text-(--ui-text,#374151)',
    image: 'w-full h-full object-cover',
    fallback: 'font-medium truncate text-(--ui-text-muted,#6b7280)',
    dot: 'absolute bottom-0 right-0 rounded-full ring-2 bg-(--rt-online,#22c55e) ring-(--ui-bg,#fff)',
  },
  variants: {
    size: {
      sm: { root: 'size-6 text-xs', dot: 'size-1.5' },
      md: { root: 'size-8 text-sm', dot: 'size-2' },
      lg: { root: 'size-10 text-base', dot: 'size-2.5' },
    },
  },
  defaultVariants: {
    size: 'md',
  },
} as const
