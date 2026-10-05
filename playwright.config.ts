// End-to-end tests: the built app (`npm run build`) against a fake Herdr
// (tests/e2e/fake-herdr.mjs), started by tests/e2e/launch.mjs.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/e2e/scenario.mjs'

const desktop = { viewport: { width: 1440, height: 900 } }

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    // The PWA service worker would cache the app between tests.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] } },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop } },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop } },
  ],
  webServer: {
    command: 'node tests/e2e/launch.mjs',
    url: `${BASE_URL}/api/state`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Default is SIGKILL: SIGTERM lets the launcher remove its temp dirs.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})
