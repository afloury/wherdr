import { expect, test, type Page } from './test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLAUDE_ASK_PANE, SOCK_FILE, fakeHerdr } from './scenario.mjs'

// A task whose agent finished (Ready to approve): its `claude` exited and left
// only the shell of its terminal. The Board's Agent tab shows the conversation
// the board recorded (task.json `session`), the terminal one tap away; the
// Reviewer tab the reviewer's (`reviewSession`) once the review is over; the
// bar says the task's state. Variants (no pane left, a live agent, nothing
// recorded) are in tests/components/BoardPanel.test.ts. All data is fictional.
const task = { id: 'shop/71', title: 'Add a dark mode toggle', stage: 'approval', state: 'blocked', kind: 'permission', app: 'claude', msg: 'Review passed: ready to approve', pr: '' }
const workerSid = '00000000-0000-4000-8000-000000000071'
const reviewerSid = '00000000-0000-4000-8000-000000000072'
const WORKER_SAID = 'The toggle is in Settings › Appearance and follows the system theme by default.'
const REVIEWER_SAID = 'Verdict: pass. The toggle persists across reloads and the contrast checks hold.'

const home = path.join(path.dirname(fs.readFileSync(SOCK_FILE, 'utf8').trim()), 'home')
const taskDir = path.join(home, '.herdr-projects/data/tasks/shop/71')
const cwd = path.join(home, 'projects/shop')
const transcriptOf = (sid: string) => path.join(home, '.claude/projects', cwd.replace(/[/.]/g, '-'), `${sid}.jsonl`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-finished-'))
fs.mkdirSync(path.join(root, 'bin'))
fs.writeFileSync(path.join(root, 'list.json'), JSON.stringify([task]))
fs.writeFileSync(path.join(root, 'details.json'), JSON.stringify({ task: { ...task, description: 'A light and a dark theme, switched in Settings.' } }))
fs.writeFileSync(path.join(root, 'bin/run.sh'), `#!/bin/sh
case "$1" in
  list) cat '${root}/list.json' ;;
  details) cat '${root}/details.json' ;;
  coordinator) echo '{"state":"none","pane":""}' ;;
  show) echo '{"settings":[],"problems":[]}' ;;
  *) echo ok ;;
esac
`, { mode: 0o755 })
const plugin = { plugin_id: 'herdr-projects', enabled: true, version: '1.2.1', plugin_root: root, startup: [{ command: ['sh', 'bin/run.sh', 'hook'] }], actions: [{ id: 'open', command: ['sh', 'bin/run.sh', 'open'] }] }

function writeTranscript(sid: string, turns: [string, string][]) {
  const base = { isSidechain: false, cwd, sessionId: sid }
  let t = Date.now() - 600_000
  const at = () => new Date(t += 30_000).toISOString()
  const lines = turns.map(([user, ai]) => [
    { ...base, type: 'user', timestamp: at(), message: { role: 'user', content: user } },
    { ...base, type: 'assistant', timestamp: at(), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'text', text: ai }] } },
  ]).flat()
  fs.mkdirSync(path.dirname(transcriptOf(sid)), { recursive: true })
  fs.writeFileSync(transcriptOf(sid), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
}

test.beforeEach(async () => {
  fs.mkdirSync(taskDir, { recursive: true })
  // The board's record: its agent's pane, its conversation, and its reviewer's (the review over).
  fs.writeFileSync(path.join(taskDir, 'task.json'), JSON.stringify({
    ...task, agent: 'claude', session: workerSid, reviewSession: reviewerSid,
    review: { by: 'claude', pass: true, findings: [] }, link: { pane: CLAUDE_ASK_PANE, reviewer: null },
  }))
  writeTranscript(workerSid, [
    ['Add a dark mode toggle to the settings page.', 'I will add a theme setting and a toggle in Settings › Appearance.'],
    ['Make it follow the system theme until someone picks one.', WORKER_SAID],
  ])
  writeTranscript(reviewerSid, [['Review the dark mode toggle.', REVIEWER_SAID]])
  // Its `claude` exited: the pane is the shell it ran in.
  await fakeHerdr('e2e.pane_agent', { pane_id: CLAUDE_ASK_PANE, agent: null })
  await fakeHerdr('e2e.plugins', { plugins: [plugin] })
})
test.afterEach(async () => {
  await fakeHerdr('e2e.plugins', { plugins: [] })
  await fakeHerdr('e2e.pane_agent', { pane_id: CLAUDE_ASK_PANE, agent: 'claude' })
  fs.rmSync(taskDir, { recursive: true, force: true })
  for (const sid of [workerSid, reviewerSid]) fs.rmSync(transcriptOf(sid), { force: true })
})
// The server reuses this board's list for REUSE_MS (5 s): the next spec file must not see it.
test.afterAll(async () => {
  fs.rmSync(root, { recursive: true, force: true })
  await new Promise(r => setTimeout(r, 5500))
})

async function open(page: Page) {
  await page.goto('/#/board?machine=&task=shop%2F71')
  const panel = page.locator('.board-panel[data-kind="task"]')
  await expect(panel.locator('.board-panel-tabs button')).toHaveText(['Task', 'Agent', 'Reviewer', 'Settings'])
  return panel
}

test('a finished task shows its agent\'s and its reviewer\'s conversations, the shell one tap away', async ({ page }) => {
  const panel = await open(page)
  const tabs = panel.locator('.board-panel-tabs')
  await tabs.getByRole('button', { name: 'Agent', exact: true }).click()
  const bar = panel.locator('.board-panel-finished-bar')
  await expect(bar.locator('.board-panel-reviewer-who')).toHaveText('Agent · Claude · Ready to approve')
  await expect(panel.locator('.task-transcript')).toContainText(WORKER_SAID)
  // Read only: no message field, no reply on its messages.
  await expect(panel.locator('.composer')).toHaveCount(0)
  // Its terminal: the shell its agent left.
  await bar.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(panel.locator('.xterm')).toBeVisible()
  await expect(panel.locator('.task-transcript')).toHaveCount(0)
  await bar.getByRole('button', { name: 'Conversation', exact: true }).click()
  await expect(panel.locator('.task-transcript')).toContainText(WORKER_SAID)
  await tabs.getByRole('button', { name: 'Reviewer', exact: true }).click()
  await expect(bar.locator('.board-panel-reviewer-who')).toHaveText('Reviewer · Claude · Review over')
  await expect(panel.locator('.task-transcript')).toContainText(REVIEWER_SAID)
})

// Before and after screenshots for review (SHOTS=<folder> only): the Agent tab
// at phone and computer widths. No assertion on what it shows, so that the
// same test captures the build before the fix.
if (process.env.SHOTS) for (const width of [390, 1440]) {
  test(`screenshot: finished task's Agent tab at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('/#/board?machine=&task=shop%2F71')
    const panel = page.locator('.board-panel[data-kind="task"]')
    await panel.locator('.board-panel-tabs').getByRole('button', { name: 'Agent', exact: true }).click()
    // Painted: the leftover shell (before the fix) or the conversation.
    await panel.locator('.xterm-screen, .task-transcript .msg-ai').first().waitFor()
    fs.mkdirSync(process.env.SHOTS!, { recursive: true })
    await page.screenshot({ path: path.join(process.env.SHOTS!, `finished-agent-${width}.png`) })
  })
}
