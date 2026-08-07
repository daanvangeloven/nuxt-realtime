import { defineContentConfig, defineCollection, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    landing: defineCollection({
      type: 'page',
      source: 'index.md',
    }),
    docs: defineCollection({
      type: 'page',
      source: {
        include: '**',
        exclude: ['index.md', 'blog/**'],
      },
      schema: z.object({
        links: z.array(z.object({
          label: z.string(),
          icon: z.string(),
          to: z.string(),
          target: z.string().optional(),
        })).optional(),
      }),
    }),
    blog: defineCollection({
      type: 'page',
      source: 'blog/**',
      schema: z.object({
        date: z.date(),
        image: z.string().optional(),
        highlighted: z.boolean().optional(),
        category: z.enum(['Release', 'Tutorial', 'Announcement', 'Article']),
        tags: z.array(z.string()).optional(),
        authors: z.array(z.object({
          name: z.string(),
          description: z.string().optional(),
          avatar: z.object({ src: z.string() }).optional(),
          to: z.string().optional(),
        })).default([]),
      }),
    }),
  },
})
