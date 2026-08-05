const images = import.meta.glob<string>('~/assets/blog/*', { eager: true, import: 'default' })
const byName = Object.fromEntries(Object.entries(images).map(([path, url]) => [path.split('/').pop()!, url]))

export function resolveBlogImage(image?: string) {
  if (!image) return undefined
  return byName[image] || image
}
