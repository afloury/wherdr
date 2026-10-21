// End-to-end tests: the built app (`npm run build`) against a fake Herdr
// (tests/e2e/fake-herdr.mjs), started by tests/e2e/launch.mjs.
import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/e2e/scenario.mjs'
import { e2eScope, projectGrep, type Project } from './tests/e2e/scope'

const desktop = { viewport: { width: 1440, height: 900 } }
// E2E_SCOPE=pr: chromium-phone runs everything, the others their tagged tests (tests/e2e/scope.ts).
const scope = e2eScope()
const grep = (name: Project) => {
  const filter = projectGrep(name, scope)
  return filter ? { grep: filter } : {}
}

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // One retry on CI only, where a flaky pass still shows as "flaky" in the report.
  // Never locally: a failure there must be seen at once.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/report.json' }],
    ['blob'],
    ['./tests/e2e/timing-reporter.ts'],
    ['./tests/e2e/scope-reporter.ts'],
  ] : [['list'], ['./tests/e2e/scope-reporter.ts']],
  use: {
    baseURL: BASE_URL,
    locale: 'en-US',
    timezoneId: 'UTC',
    // The PWA service worker would cache the app between tests.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-phone', use: { ...devices['iPhone 13'], browserName: 'chromium' }, ...grep('chromium-phone') },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] }, ...grep('webkit-phone') },
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...desktop }, ...grep('chromium-desktop') },
    { name: 'webkit-desktop', use: { ...devices['Desktop Safari'], ...desktop }, ...grep('webkit-desktop') },
  ],
  webServer: {
    command: 'node tests/e2e/launch.mjs',
    url: `${BASE_URL}${process.env.E2E_PDF_AUTH ? '/api/health' : '/api/state'}`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Default is SIGKILL: SIGTERM lets the launcher remove its temp dirs.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
})
