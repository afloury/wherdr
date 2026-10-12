// Regression proofs from the independent t-0329 review.
// Its optional comparison to an unversioned main archive is already covered
// by nativeScreenParity.test.ts and is deliberately not a runtime dependency.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as choices from '../server/utils/choices'
import * as wait from '../server/utils/waitScreen'
import * as menu from '../shared/menuScreen'
import * as settings from '../shared/settingsScreen'
import { parseUsageLimit } from '../shared/usageLimit'
import { classifyScreen } from '../shared/interactiveScreen'
import { keepReading, ScreenCache } from '../server/utils/screenCache'
import { isPermissionQuestion, mergeDetail } from '../server/utils/promptDetail'
import { bindFunction, sourceFunction } from './stateFunction'
import ts from 'typescript'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
// eslint-disable-next-line no-control-regex
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m|\r/g, '')

// The production poll branch and choicesFor, with a scripted screen and clock.
// `revision` stays constant, as measured on Herdr 0.9.3 for an idle agent
// whose screen changes.
function poller(screenAt: (now: number) => string, watchUntil = 0) {
  let now = 0
  let reads = 0
  const clock = { now: () => now }
  const cache = new ScreenCache()
  const screenWatch = new Map<string, number>(watchUntil ? [['w1:p1', watchUntil]] : [])
  const getChoices = bindFunction(source, 'choicesFor', {
    ...choices, ...wait, ...menu, ...settings, classifyScreen, parseUsageLimit, keepReading, isPermissionQuestion, mergeDetail,
    Date: clock, choicesCache: cache, screenWatch, askChecks: new Map(),
    isViewed: () => false, modelControlBusy: () => false, noteScreen: () => {},
    herdr: async () => { reads++; return { read: { text: plain(screenAt(now)) } } },
    readMenu: async () => menu.parseMenu(screenAt(now)),
    transcripts: { pendingAsk: async () => [], pendingClaudeQuestions: async () => [], pendingTool: async () => null },
  })
  const file = ts.createSourceFile('enrich.ts', sourceFunction(source, 'enrich'), ts.ScriptTarget.Latest, true)
  let branch: ts.IfStatement | undefined
  const visit = (n: ts.Node) => {
    if (ts.isIfStatement(n) && n.expression.getText(file) === "p.status !== 'working'") branch = n
    ts.forEachChild(n, visit)
  }
  visit(file)
  const cycle = bindFunction(`async function cycle(p) { ${branch!.getText(file)}; return p }`, 'cycle', {
    Date: clock, choicesFor: getChoices, isViewed: () => true,
    choicesCache: cache, askChecks: new Map(), revs: new Map([['w1:p1', 1]]),
  })
  return {
    async run(pane: Record<string, unknown>, until: number) {
      let p = pane
      for (; now < until; now += 1000) p = await cycle({ ...pane })
      return { pane: p, reads: () => reads }
    },
  }
}

describe('t-0329: idle readings are frozen while Herdr keeps the same revision', () => {
  it('a Codex menu opened by a "/" command stays "terminal" after the field returns', async () => {
    // "/" command sent from wherdr: screen watched for 60 s (watchScreen). The
    // user leaves the menu with Escape after 90 s.
    const p = poller(now => (now < 90_000 ? fx('codex-command-center.txt') : fx('codex-idle.txt')), 60_000)
    const { pane, reads } = await p.run({ id: 'w1:p1', agent: 'codex', status: 'idle', agentSession: 'neutral' }, 600_000)
    console.log('stale terminal: reads in 10 min =', reads(), '· final interaction =', pane.interaction)
    expect(pane.interaction).toBe('input')
  })
  it('a starting agent (status unknown, no session yet) is read once and never again', async () => {
    // Folder trust drawn two seconds after the first poll.
    const p = poller(now => (now < 2000 ? '' : fx('codex-trust.txt')))
    const { pane, reads } = await p.run({ id: 'w1:p1', agent: 'codex', status: 'unknown', agentSession: null }, 120_000)
    console.log('starting agent: reads in 2 min =', reads(), '· prompt =', Boolean(pane.prompt))
    expect(pane.prompt).toBeTruthy()
  })
})

describe('t-0329: a native Codex card becomes a terminal window', () => {
  for (const file of readdirSync(new URL('./fixtures/', import.meta.url)).filter(f => /^codex-approve-/.test(f))) {
    it(`${file} below a reply that quotes "Agent Command Center"`, async () => {
      const text = `• The menu is titled:\n  Agent Command Center\n\n${fx(file)}`
      const p = poller(() => text)
      const { pane } = await p.run({ id: 'w1:p1', agent: 'codex', status: 'blocked', agentSession: 'neutral' }, 2000)
      expect(choices.parseChoices(text)).toBeTruthy()
      expect(pane.interaction).toBe('native')
      expect(pane.prompt).toBeTruthy()
    })
  }
})


it('stops polling a cached terminal after the agent closes without a new revision', async () => {
  let closed = false
  const p = poller(() => closed ? 'user@host demo % ' : fx('codex-command-center.txt'))
  const pane = { id: 'w1:p1', agent: 'codex', status: 'idle', agentSession: 'neutral' }
  const before = await p.run(pane, 60_000)
  const readsBefore = before.reads()
  expect(before.pane.interaction).toBe('terminal')
  closed = true
  const after = await p.run({ ...pane, status: 'unknown' }, 120_000)
  expect(after.pane.interaction).toBe('unknown')
  expect(after.reads() - readsBefore).toBe(1)
})
