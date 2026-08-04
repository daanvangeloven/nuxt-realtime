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

      <UBlogPosts class="md:grid-cols-2 lg:grid-cols-3">
        <UBlogPost
          v-for="(post, index) in filteredPosts"
          :key="post.path"
          :to="post.path"
          :title="post.title"
          :description="post.description"
          :image="post.image ? { src: resolveBlogImage(post.image), alt: post.title } : undefined"
          :date="new Date(post.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })"
          :authors="post.authors?.map(author => ({ ...author, avatar: author.avatar ? { ...author.avatar, alt: `${author.name} avatar` } : undefined }))"
          :badge="{ label: post.category, color: 'primary', variant: 'subtle' }"
          :variant="index === 0 ? 'outline' : 'subtle'"
          :orientation="index === 0 ? 'horizontal' : 'vertical'"
          :class="[index === 0 && 'col-span-full']"
          :ui="index === 0 ? { body: 'lg:px-6' } : undefined"
        />
      </UBlogPosts>
    </UPageBody>
  </UContainer>
</template>
