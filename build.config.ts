import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    './src/drivers/redis',
  ],
  externals: ['nitropack', 'unstorage', 'unstorage/drivers/redis', 'ioredis', 'socket.io', 'socket.io-client', 'engine.io', 'ws', 'consola', '@nuxt/devtools-kit'],
})
