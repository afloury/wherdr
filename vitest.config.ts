import { defineConfig } from 'vitest/config'

// Tests of the pure server modules (without Nuxt): prompts, transcripts, locking.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
