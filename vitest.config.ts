import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// Two projects:
// - unit: pure server / shared / app modules, plain Node (fast, no Nuxt).
// - components: Vue components mounted in a Nuxt environment (auto-imports,
//   Nuxt UI) on happy-dom, files in tests/components/.
export default defineConfig({
  // Fixed TS transform options (the ones Nuxt's generated tsconfig sets):
  // given as a string, Vite does not look up a tsconfig.json per file, so the
  // suite runs in a fresh clone without any generated .nuxt — including the
  // website/ modules, whose tsconfig.json extends website/.nuxt.
  esbuild: {
    tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'ESNext', verbatimModuleSyntax: true, useDefineForClassFields: true, alwaysStrict: true } }),
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/*.test.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'components',
          include: ['tests/components/**/*.test.ts'],
          environment: 'nuxt',
          environmentOptions: { nuxt: { domEnvironment: 'happy-dom' } },
          // The first mount builds the Nuxt app: slow on small machines.
          testTimeout: 20000,
        },
      }),
    ],
  },
})
