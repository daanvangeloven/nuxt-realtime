<script setup lang="ts">
definePageMeta({
  layout: false,
})

const route = useRoute()
const { toc } = useAppConfig()

const [{ data: page }, { data: surround }] = await Promise.all([
  useAsyncData(route.path, () => queryCollection('blog').path(route.path).first()),
  useAsyncData(`${route.path}-surround`, () => {
    return queryCollectionItemSurroundings('blog', route.path, {
      fields: ['description'],
    }).order('date', 'DESC')
  }),
])

if (!page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Post not found', fatal: true })
}

useSeoMeta({
  title: page.value.title,
  ogTitle: page.value.title,
  description: page.value.description,
  ogDescription: page.value.description,
})

const links = computed(() => {
  const links = []
  if (toc?.bottom?.edit) {
    links.push({
      icon: 'i-lucide-external-link',
      label: 'Edit this post',
      to: `${toc.bottom.edit}/blog/${page?.value?.stem}.${page?.value?.extension}`,
      target: '_blank',
    })
  }

  return [...links, ...(toc?.bottom?.links || [])].filter(Boolean)
})
</script>

<template>
  <UContainer v-if="page">
    <UPage>
      <UPageHeader
        :title="page.title"
        :description="page.description"
        :ui="{ headline: 'flex flex-col gap-y-6 items-start' }"
      >
        <template #headline>
          <UBreadcrumb :items="[{ label: 'Blog', icon: 'i-lucide-newspaper', to: '/blog' }, { label: page.title }]" />

          <div class="flex items-center gap-2">
            <UBadge
              :label="page.category"
              color="primary"
              variant="subtle"
            />
            <span class="text-muted">
              <time>{{ new Date(page.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) }}</time>
            </span>
          </div>
        </template>

        <div
          v-if="page.authors?.length"
          class="mt-4 flex flex-wrap items-center gap-6"
        >
          <UUser
            v-for="(author, index) in page.authors"
            :key="index"
            v-bind="author"
          />
        </div>
      </UPageHeader>

      <UPageBody>
        <img
          v-if="page.image"
          :src="resolveBlogImage(page.image)"
          :alt="page.title"
          class="w-full rounded-lg border border-default mb-8"
        >

        <ContentRenderer :value="page" />

        <div class="flex items-center justify-between mt-12 not-prose">
          <ULink
            to="/blog"
            class="text-primary"
          >
            ← Back to blog
          </ULink>
        </div>

        <USeparator v-if="surround?.length" />

        <UContentSurround :surround="surround" />
      </UPageBody>

      <template
        v-if="page?.body?.toc?.links?.length"
        #right
      >
        <UContentToc
          :title="toc?.title"
          :links="page.body?.toc?.links"
        >
          <template
            v-if="toc?.bottom"
            #bottom
          >
            <div class="hidden lg:block space-y-6">
              <USeparator
                v-if="page.body?.toc?.links?.length"
                type="dashed"
              />

              <UPageLinks
                :title="toc.bottom.title"
                :links="links"
              />
            </div>
          </template>
        </UContentToc>
      </template>
    </UPage>
  </UContainer>
</template>
