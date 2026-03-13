import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/drivers/redis',
  ],
  externals: ['nitropack', 'unstorage', 'unstorage/drivers/redis', 'ioredis'],
})
