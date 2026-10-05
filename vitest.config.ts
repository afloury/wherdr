import { defineConfig } from 'vitest/config'

// Tests of the pure server modules (without Nuxt): prompts, transcripts, locking.
export default defineConfig({
  // Fixed TS transform options (the ones Nuxt's generated tsconfig sets):
  // given as a string, Vite does not look up a tsconfig.json per file, so the
  // suite runs in a fresh clone without any generated .nuxt — including the
  // website/ modules, whose tsconfig.json extends website/.nuxt.
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'ESNext', verbatimModuleSyntax: true, useDefineForClassFields: true, alwaysStrict: true } }),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
