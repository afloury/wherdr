// Playwright's `test` for every spec, with one addition: the settings kept on
// the server (DATA_DIR/settings.json, shared/settings.ts) are cleared before
// each test. One server serves all the specs, one after another: without this,
// a setting changed or seeded by one test would apply to the next ones, and a
// spec's localStorage values would no longer be taken up by the migration.
import { test as base, type APIRequestContext, type Page } from '@playwright/test'
import { SYNCED_SETTINGS } from '../../shared/settings'
import { BASE_URL } from './scenario.mjs'

export * from '@playwright/test'

export async function resetSettings(request: APIRequestContext) {
  const r = await request.post(`${BASE_URL}/api/settings`, {
    headers: { Origin: BASE_URL },
    data: { settings: Object.fromEntries(SYNCED_SETTINGS.map(k => [k, null])) },
  })
  // A locked app (E2E_PDF_AUTH) refuses it: nothing was changed without unlocking.
  if (!r.ok() && r.status() !== 401) throw new Error(`settings reset: HTTP ${r.status()}`)
}

// The agent kind shown in the pane header: the desktop status pill, or the phone
// identity, where an unnamed pane is titled by its kind and the meta line then
// leaves the repeated kind out.
export function agentKind(page: Page, kind: string) {
  return page.locator('.agent-top .pill-kind, .agent-top .phone-identity-kind, .agent-top .phone-identity-title')
    .filter({ hasText: new RegExp(`^${kind}$`, 'i') }).first()
}

export const test = base.extend<{ freshSettings: void }>({
  freshSettings: [async ({ request }, use) => {
    await resetSettings(request)
    await use()
  }, { auto: true }],
})
