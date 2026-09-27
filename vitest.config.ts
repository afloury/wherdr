import { defineConfig } from 'vitest/config'

// Tests des modules purs du serveur (sans Nuxt) : invites, transcriptions, verrouillage.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
