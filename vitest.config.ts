import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

// Two projects:
// - unit: pure server / shared / app modules, plain Node (fast, no Nuxt).
// - components: Vue components mounted in a Nuxt environment (auto-imports,
//   Nuxt UI) on happy-dom, files in tests/components/.
export default defineConfig({
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
