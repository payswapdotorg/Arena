import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        '**/*.test.ts',
        '**/*.test.js',
        '**/*.d.ts',
        '**/*.config.*',
        '**/setup.ts'
      ]
    },
    retry: 2,
    hookTimeout: 10000,
    testTimeout: 30000
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname
    }
  }
})