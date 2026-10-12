import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { herdrSock } from '../server/utils/herdr'
import { keepReading } from '../server/utils/screenCache'
import * as choices from '../server/utils/choices'
import { parseWaitScreen } from '../server/utils/waitScreen'
import { parseMenu, TOP } from '../shared/menuScreen'
import { settingsTabs } from '../shared/settingsScreen'
import { isPermissionQuestion, mergeDetail } from '../server/utils/promptDetail'
import { parseUsageLimit } from '../shared/usageLimit'
import { classifyScreen } from '../shared/interactiveScreen'
import { bindFunction, sourceFunction } from './stateFunction'

for (const variant of ['weekly', 'session']) for (const status of ['idle', 'blocked']) {
  it(`caches a ${variant} quota wait while ${status} for hours until the revision changes`, async () => {
    const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
    let text = readFileSync(new URL(`./fixtures/claude-limit-${variant}.txt`, import.meta.url), 'utf8')
    let now = 0
    const read = vi.fn(async () => ({ read: { text } }))
    const getChoices = bindFunction(source, 'choicesFor', {
      ...choices, parseWaitScreen, parseMenu, TOP, settingsTabs, classifyScreen, parseUsageLimit, keepReading, isPermissionQuestion, mergeDetail,
      Date: { now: () => now }, choicesCache: new Map(), screenWatch: new Map(), askChecks: new Map(),
      modelControlBusy: () => false, herdr: read, noteScreen: () => {},
    })
    const pane = { id: 'w1:p1', agent: 'claude', status }
    const strict = status !== 'blocked'
    // Simulate six hours of normal polls, including the raw blocked state.
    for (now = 0; now < 6 * 60 * 60_000; now += 1000) {
      expect((await getChoices(pane, 1, strict)).usageLimit).toBeTruthy()
    }
    expect(read).toHaveBeenCalledOnce()
    text = readFileSync(new URL('./fixtures/claude-idle.txt', import.meta.url), 'utf8')
    // Keep the real idle field/footer without the historical /context output.
    text = text.slice(text.indexOf('────────────────'))
    expect((await getChoices(pane, 2, strict)).usageLimit).toBeUndefined()
    expect(read).toHaveBeenCalledTimes(2)
  })
}

it('measures working, resting, closed and watched-screen RPCs against a local Unix-socket responder', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wherdr-read-cost-'))
  const sock = path.join(tmp, 'rpc.sock')
  const durations: number[] = []
  const server = net.createServer(connection => {
    let buffer = ''
    connection.on('data', data => {
      buffer += data
      if (!buffer.includes('\n')) return
      const request = JSON.parse(buffer.split('\n')[0]!)
      connection.end(JSON.stringify({ id: request.id, result: { read: { text: 'Thinking…' } } }) + '\n')
    })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(sock, resolve) })
  try {
    const source = readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8')
    const counts: Record<string, number> = {}
    for (const agent of ['claude', 'codex', 'omp']) for (const status of ['working', 'idle', 'unknown']) for (const viewed of [false, true]) {
      let now = 0
      let reads = 0
      const cache = new Map()
      const clock = { now: () => now }
      const idle = readFileSync(new URL(`./fixtures/${agent === 'omp' ? 'omp-idle-footer' : `${agent}-idle`}.txt`, import.meta.url), 'utf8')
      const read = async () => {
        const at = performance.now()
        const result = await herdrSock(sock, 'pane.read', { pane_id: 'w1:p1', source: 'detection' })
        durations.push(performance.now() - at)
        reads++
        return { ...result, read: { text: status === 'unknown' ? 'user@host demo % ' : idle } }
      }
      const getChoices = bindFunction(source, 'choicesFor', {
        ...choices, parseWaitScreen, parseMenu, TOP, settingsTabs, classifyScreen, parseUsageLimit, keepReading, isPermissionQuestion, mergeDetail,
        Date: clock, choicesCache: cache, screenWatch: new Map(), askChecks: new Map(),
        modelControlBusy: () => false, herdr: read, noteScreen: () => {},
      })
      const file = ts.createSourceFile('enrich.ts', sourceFunction(source, 'enrich'), ts.ScriptTarget.Latest, true)
      let branch: ts.IfStatement | undefined
      const visit = (n: ts.Node) => {
        if (ts.isIfStatement(n) && n.expression.getText(file) === "p.status !== 'working'") branch = n
        ts.forEachChild(n, visit)
      }
      visit(file)
      if (!branch) throw new Error('Missing working branch')
      const cycle = bindFunction(`async function cycle(p) { ${branch.getText(file)} }`, 'cycle', {
        Date: clock, choicesFor: getChoices, isViewed: () => viewed,
        choicesCache: cache, askChecks: new Map(), revs: new Map([['w1:p1', 1]]),
      })
      // Replay sixty normal one-second polls, without a minute-long sleep.
      for (now = 0; now < 60_000; now += 1000) await cycle({ id: 'w1:p1', agent, status, agentSession: 'neutral' })
      counts[`${agent}/${status}/${viewed ? 'viewed' : 'unviewed'}`] = reads
      expect(reads).toBe(status === 'working' ? 0 : 1)
    }
    const sorted = durations.toSorted((a, b) => a - b)
    const result = {
      method: '60 one-second polls per agent/status; production enrichment branch and choicesFor; real local Unix-socket RPC to neutral responder',
      counts, samples: durations.length,
      meanMs: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      limitation: 'Mac local responder; excludes real Herdr screen extraction, SSH, Pi and network latency. Existing activity/model reads are outside this branch.',
    }
    console.log('Interactive read cost:', JSON.stringify(result))
    if (process.env.READ_COST_REPORT) writeFileSync(process.env.READ_COST_REPORT, JSON.stringify(result, null, 2) + '\n')
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(tmp, { recursive: true, force: true })
  }
})
