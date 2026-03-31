import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: loadEnv('test', process.cwd(), ''),
    globalSetup: ['./src/__tests__/global-setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
