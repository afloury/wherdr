import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { herdrSock } from '../server/utils/herdr'
import { keepReading } from '../server/utils/screenCache'
import * as choices from '../server/utils/choices'
import { parseWaitScreen } from '../server/utils/waitScreen'
import { parseMenu, TOP } from '../shared/menuScreen'
import { settingsTabs } from '../shared/settingsScreen'
import { classifyScreen } from '../shared/interactiveScreen'
import { bindFunction, sourceFunction } from './stateFunction'

it('measures the removed working-screen RPCs against a local Unix-socket responder', async () => {
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
    const sources = {
      main: execFileSync('git', ['show', 'a430192:server/utils/state.ts'], { encoding: 'utf8' }),
      reviewed: execFileSync('git', ['show', 'f54b0cc:server/utils/state.ts'], { encoding: 'utf8' }),
      corrected: readFileSync(new URL('../server/utils/state.ts', import.meta.url), 'utf8'),
    }
    const counts: Record<string, number> = {}
    for (const [version, source] of Object.entries(sources)) for (const agent of ['claude', 'codex', 'omp']) for (const status of ['working', 'idle']) {
      let now = 0
      let reads = 0
      const cache = new Map()
      const clock = { now: () => now }
      const read = async () => {
        const at = performance.now()
        const result = await herdrSock(sock, 'pane.read', { pane_id: 'w1:p1', source: 'detection' })
        durations.push(performance.now() - at)
        reads++
        return result
      }
      const getChoices = bindFunction(source, 'choicesFor', {
        ...choices, parseWaitScreen, parseMenu, TOP, settingsTabs, classifyScreen, keepReading,
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
        Date: clock, choicesFor: getChoices, isViewed: () => true,
        choicesCache: cache, askChecks: new Map(), revs: new Map([['w1:p1', 1]]),
      })
      // Replay sixty normal one-second polls, without a minute-long sleep.
      for (now = 0; now < 60_000; now += 1000) await cycle({ id: 'w1:p1', agent, status, agentSession: 'neutral' })
      counts[`${version}/${agent}/${status}`] = reads
      expect(reads).toBe(status === 'working' ? (version === 'reviewed' ? 20 : 0) : version === 'main' ? 1 : 20)
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
