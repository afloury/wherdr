// End-to-end tests (v3): the built app (`npm run build`) on Chromium at iPhone size.
// Each spec starts its own server and fake herdr-core socket (tests/e2e/core.ts), so
// there is no webServer here. The v2 suite (fake Herdr, WebKit, desktop) lives on
// develop and main.
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
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
