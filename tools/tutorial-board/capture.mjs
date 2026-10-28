// Capture the real UI; only the Board responses are fictional read-only fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const output = process.env.TUTORIAL_OUT;
const url = process.env.TUTORIAL_URL || 'http://127.0.0.1:7696';
assert.ok(output, 'Set TUTORIAL_OUT');
assert.match(url, /^http:\/\/127\.0\.0\.1:769[0-9]$/);
const state = await (await fetch(`${url}/api/state`)).json();
assert.equal(state.ok, true);
assert.match(state.session, /^hwtest/); // Never capture a default Herdr session.
const row = (n, title, group, extra = {}) => ({ id: `demo/${n}`, repo: 'demo', n, title, group,
  state: group === 'working' ? 'working' : group === 'todo' ? 'idle' : 'blocked',
  stage: group === 'needs' ? 'asks' : group === 'ready' ? 'approval' : group,
  kind: group === 'needs' ? 'question' : group === 'ready' ? 'permission' : '', app: 'claude', msg: '', ...extra });
const rows = [row(12, 'Make CSV exports predictable', 'needs', { msg: 'Should archived records be included?' }),
  row(11, 'Add webhook retries', 'ready', { pr: 'https://github.com/example/demo/pull/11', review: { pass: true, tally: 'All checks passed', by: 'claude' } }),
  row(13, 'Add API rate limits', 'working', { msg: 'Writing regression tests', progress: 65 }),
  row(14, 'Document the API', 'todo')];
const details = r => ({ ...r, agent: 'claude', pane: null, worktree: '', branch: '', archived: false,
  description: r.n === 12 ? 'Keep CSV columns in a consistent order. Add regression coverage for exported records.' : 'Retry temporary webhook failures with exponential backoff.',
  summary: r.n === 11 ? 'Retry handling is complete. Regression tests pass. Ready for your review.' : '',
  review: r.review || null, reviewRounds: r.n === 11 ? 1 : 0, report: null, failure: '', failureTitle: '', plan: '' });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.TUTORIAL_BROWSER });
const provenance = { appCommit: process.env.TUTORIAL_SOURCE_REVISION || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), session: state.session, source: 'Real wherdr UI; fictional Board fixtures', frames: [], actions: [] };
try {
  const context = await browser.newContext({ viewport: { width: 440, height: 720 }, deviceScaleFactor: 2,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request(), target = new URL(request.url());
    if (target.origin !== url || request.method() !== 'GET') return route.abort();
    if (target.pathname.startsWith('/api/tasks')) {
      let json = { machines: [], settings: [], problems: [] };
      if (target.pathname === '/api/tasks') json = { version: 'tutorial', machines: [{ machine: '', status: 'ready', version: '1.2.26', tasks: rows }] };
      if (target.pathname === '/api/tasks/details') json = details(rows.find(r => r.id === target.searchParams.get('id')) || rows[0]);
      if (target.pathname === '/api/tasks/coordinator') json = { state: 'none', pane: null };
      return route.fulfill({ json });
    }
    return route.continue();
  });
  const page = await context.newPage();
  const capture = async (id, target) => {
    await page.waitForTimeout(250);
    const image = await page.screenshot({ path: join(output, `${id}.png`) });
    const focus = target ? await target.boundingBox() : { x: 20, y: 140, width: 400, height: 300 };
    provenance.frames.push({ id, sha256: createHash('sha256').update(image).digest('hex'), focus });
  };
  await page.goto(`${url}/#/board`);
  await page.locator('.task-card').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await capture('intro', page.locator('.board-seg'));
  await capture('board', page.locator('.board-seg'));
  await capture('needs', page.locator('.task-card[data-task="demo/12"]'));
  await page.locator('.task-card[data-task="demo/12"] .task-card-open').click({ position: { x: 12, y: 12 } });
  provenance.actions.push('Open needs-you task');
  await page.locator('.board-panel-tabs').getByRole('button', { name: 'Task', exact: true }).click();
  await page.locator('.task-description').waitFor();
  await capture('details', page.locator('.task-description'));
  await page.getByRole('button', { name: 'Back to the Board', exact: true }).click();
  await page.locator('.board-seg-btn.ready').click();
  await page.locator('.task-card[data-task="demo/11"] .task-card-open').click({ position: { x: 12, y: 12 } });
  await page.locator('.board-panel-tabs').getByRole('button', { name: 'Task', exact: true }).click();
  await page.locator('.task-description').waitFor();
  provenance.actions.push('Inspect ready-to-approve task context; no approval sent');
  await capture('context', page.locator('.task-sheet-facts'));
  provenance.frames.at(-1).secondary = await page.locator('.board-panel-note').boundingBox();
  await page.getByRole('button', { name: 'Back to the Board', exact: true }).click();
  await page.locator('.board-seg-btn.working').click();
  await capture('working', page.locator('.task-card[data-task="demo/13"]'));
  await capture('outro', page.locator('.task-card[data-task="demo/13"]'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await capture('desktop');
  await writeFile(join(output, 'capture.json'), JSON.stringify(provenance, null, 2));
} finally { await browser.close(); }
