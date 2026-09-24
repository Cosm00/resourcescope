import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Stores touch localStorage; jsdom provides it.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
