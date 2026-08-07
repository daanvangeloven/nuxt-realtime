<script setup lang="ts">
definePageMeta({
  layout: false,
})

const { data: posts } = await useAsyncData('blog', () => queryCollection('blog').order('date', 'DESC').all())

const tags = computed(() => [...new Set(posts.value?.flatMap(post => post.tags || []))])
const activeTag = ref<string | null>(null)

const filteredPosts = computed(() => {
  if (!activeTag.value) return posts.value || []
  return (posts.value || []).filter(post => post.tags?.includes(activeTag.value!))
})

const highlightedPost = computed(() => filteredPosts.value.find(post => post.highlighted) ?? filteredPosts.value[0])

function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

useSeoMeta({
  title: 'Blog',
  ogTitle: 'Blog',
  description: 'Articles and release notes about Nuxt Realtime.',
})
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Blog"
      description="Articles and release notes about Nuxt Realtime."
    />

    <UPageBody>
      <div
        v-if="tags.length"
        class="flex flex-wrap gap-2 mb-8"
      >
        <UButton
          label="All"
          size="sm"
          :color="activeTag === null ? 'primary' : 'neutral'"
          :variant="activeTag === null ? 'solid' : 'subtle'"
          @click="activeTag = null"
        />
        <UButton
          v-for="tag in tags"
          :key="tag"
          :label="tag"
          size="sm"
          :color="activeTag === tag ? 'primary' : 'neutral'"
          :variant="activeTag === tag ? 'solid' : 'subtle'"
          @click="activeTag = tag"
        />
      </div>

      <p
        v-if="highlightedPost"
        class="flex items-center gap-1.5 text-sm font-semibold text-muted mb-3"
      >
        Highlighted post
      </p>
      <UBlogPosts
        v-if="highlightedPost"
        class="mb-12"
      >
        <UBlogPost
          :to="highlightedPost.path"
          :title="highlightedPost.title"
          :description="highlightedPost.description"
          :image="highlightedPost.image ? { src: resolveBlogImage(highlightedPost.image), alt: highlightedPost.title } : undefined"
          :date="formatDate(highlightedPost.date)"
          :authors="highlightedPost.authors?.map(author => ({ ...author, avatar: author.avatar ? { ...author.avatar, alt: `${author.name} avatar` } : undefined }))"
          :badge="{ label: highlightedPost.category, color: 'primary', variant: 'subtle' }"
          variant="outline"
          orientation="horizontal"
          class="col-span-full"
          :ui="{ body: 'lg:px-6' }"
        />
      </UBlogPosts>

      <p
        v-if="filteredPosts.length"
        class="text-sm font-semibold text-muted mb-3"
      >
        All posts
      </p>
      <UTimeline
        v-if="filteredPosts.length"
        :items="filteredPosts.map(post => ({
          date: formatDate(post.date),
          title: post.title,
          description: post.description,
          value: post.path,
          icon: 'i-lucide-newspaper',
        }))"
      >
        <template #wrapper="{ item }">
          <ULink
            :to="item.value"
            class="block rounded-lg border border-default p-4 -mt-1 transition-colors hover:border-primary hover:bg-elevated"
          >
            <p class="text-muted text-sm">
              {{ item.date }}
            </p>
            <p class="font-semibold">
              {{ item.title }}
            </p>
            <p class="text-muted mt-1">
              {{ item.description }}
            </p>
          </ULink>
        </template>
      </UTimeline>
    </UPageBody>
  </UContainer>
</template>
