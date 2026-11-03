// Smoke e2e for the herdr-core backend (v3): the core-smoke, core-attach, core-machines and core-keybar specs on Chromium. The spec starts
// its own server and fake core socket, so there is no webServer here (the v2 fake
// Herdr launcher is not needed). Run with `npx playwright test -c playwright.core.config.ts`
// after `WHERDR_BACKEND=core NUXT_PUBLIC_CORE=true npm run build`.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  // core-connection and core-layout are out until they follow the one-row-per-terminal home (#329):
  // they assert the old workspace rows and counters and fail on develop today.
  testMatch: /core-(smoke|attach|machines|keybar)\.spec\.ts$/,
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium-phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
})
