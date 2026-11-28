import { describe, expect, it, vi } from 'vitest'
import { createCoreTranscripts } from '../server/utils/coreTranscripts'
import { createTranscripts, type Loc, type TranscriptPane } from '../server/utils/transcripts'
import type { MachineFs } from '../server/utils/fsx'
import { CoreError } from '../server/utils/core'
import type { ChatResponse, Pane } from '../shared/types'
import { defer, memFs, type MemFile, type MemIo } from './cmdStateFixture'
import { assistant, at, J, results, sess as psess, user } from './cmdParserFixture'
import { AGENT_CENSUS_SCRIPT, CMD_FILES_SCRIPT, CMD_HEADERS_SCRIPT, clock, F, filesWire, GAP, H, hdrs, HOME, OTHER, POST, POST2, POSTOBS, retitled, S, sess, st, T, U1, U2, wire, WORK } from './cmdCoreFixture'

const pane = (id: string, address: string, agent: string | null, cwd = WORK) =>
  ({ id, coreAddress: address, agent, cwd, machine: '', agentSession: null, status: 'idle' }) as Pane
// terminal.get carries a REQUIRED state: a cmd detail always spells it out,
// never defaulted.
const liveD = (o: object) => ({ state: 'live', ...o })

interface Wires { census?: string, files?: string, headers?: (a: string[]) => string }

// A "core" answering terminal.get from a table and machine.exec purely from
// wire fixtures. The census/files/header scripts are stubbed EXPLICITLY and
// this helper never execFile's — a wire script can never reach host /proc.
function cmdCore(details: Record<string, object>, wires: Wires | ((on: string) => Wires | undefined), opts: { home?: string } = {}) {
  const calls = { get: [] as string[], exec: [] as { on?: string, hasOn: boolean }[], census: 0, files: 0, headers: 0 }
  const call = async (method: string, params: any): Promise<any> => {
    if (method === 'terminal.get') {
      calls.get.push(params.terminal)
      if (!details[params.terminal]) throw new CoreError('not_found', 'x')
      return details[params.terminal]
    }
    if (method === 'machine.exec') {
      calls.exec.push({ on: params.on, hasOn: 'on' in params })
      // argv is ['sh', '-c', script, 'sh', ...args]: the script is [2],
      // real arguments start after the $0 placeholder at [4].
      const script = params.argv?.[2] as string | undefined
      const args = (params.argv ?? []).slice(4) as string[]
      const w = typeof wires === 'function' ? wires(params.on || '') : wires
      const out = (s: string) => ({ code: 0, stdout: Buffer.from(s).toString('base64') })
      if (script === 'printf %s "$HOME"') return out(opts.home ?? HOME)
      if (script === AGENT_CENSUS_SCRIPT) { calls.census++; return out(w?.census ?? `${H}T 0 0 0 0\n`) }
      // The listing script ends in ONE base64 over the whole stream: a wire
      // fixture is written plainly and encoded here.
      if (script === CMD_FILES_SCRIPT) { calls.files++; return out(wire(w?.files ?? 'H\u0000T\u00000\u00000\u00000\u00000\u0000')) }
      if (script === CMD_HEADERS_SCRIPT) { calls.headers++; return out(w?.headers?.(args) ?? 'H\nT 0 0 0\n') }
      throw new CoreError('rpc', `unexpected machine.exec: ${String(script).slice(0, 60)}`)
    }
    throw new CoreError('rpc', method)
  }
  return { call, calls }
}

describe('Command Code panes resolve via core detail and per-machine wires', () => {
  // A CHILD target (fg 4242 under shell root 9000) binds birth to the first
  // machine observation, so every positive write here is post-observation.
  const okWire = (extra: Partial<Wires> = {}): Wires => ({
    census: H + S(4242) + T(1, 1),
    files: filesWire([[F('a', U1), st(POSTOBS)]]),
    headers: hdrs({ [F('a', U1)]: { st: st(POSTOBS), body: sess(U1) } }),
    ...extra
  })
  const P = (id: string) => ({ id, agent: 'cmd', cwd: WORK })

  it('resolves a local pane through machine.exec with NO on field (by intent, not an empty name)', async () => {
    const core = cmdCore({ t1: liveD({ pid: 9000, argv: ['bash', '-l'], foreground: { pid: 4242 } }) }, okWire())
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate(P('p1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
    expect(core.calls.get).toEqual(['t1'])
    for (const e of core.calls.exec) expect(e.hasOn).toBe(false) // local exec: no `on` field, never an empty name
    expect([core.calls.census, core.calls.files, core.calls.headers]).toEqual([2, 1, 1])
  })

  it('scopes remote evidence to the pane machine and the exact address', async () => {
    const core = cmdCore({ 'box/t1': liveD({ pid: 9000, argv: ['bash', '-l'], foreground: { pid: 4242 } }) }, okWire())
    const panes = [pane('r1', 'box/t1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: '/unrelated' })
    expect(await t.locate(P('r1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
    expect(core.calls.get).toEqual(['box/t1']) // the full address, not a suffix
    for (const e of core.calls.exec) expect(e.on).toBe('box')
  })

  it('keeps identical pids and address suffixes on different machines apart', async () => {
    const wireOf = (dir: string, cwd: string, id: string): Wires => ({
      census: H + S(4242, { cwd }) + T(1, 1),
      files: filesWire([[F(dir, id), st(POST)]]),
      headers: hdrs({ [F(dir, id)]: { st: st(POST), body: sess(id, cwd) } })
    })
    const byMachine: Record<string, Wires> = { box: wireOf('pa', '/w/a', U1), 'host-a': wireOf('pb', '/w/b', U2) }
    const core = cmdCore({
      'box/t1': liveD({ pid: 4242, argv: ['cmd'], foreground: { pid: 4242 } }),
      'host-a/t1': liveD({ pid: 4242, argv: ['cmd'], foreground: { pid: 4242 } })
    }, on => byMachine[on])
    const panes = [pane('pa', 'box/t1', 'cmd', '/w/a'), pane('pb', 'host-a/t1', 'cmd', '/w/b')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: '/unrelated' })
    expect(await t.locate({ id: 'pa', agent: 'cmd', cwd: '/w/a' })).toEqual({ file: F('pa', U1), session: U1, guessed: true })
    expect(await t.locate({ id: 'pb', agent: 'cmd', cwd: '/w/b' })).toEqual({ file: F('pb', U2), session: U2, guessed: true })
  })

  it('binds the single direct cmd child of a shell root', async () => {
    const core = cmdCore(
      { t1: liveD({ pid: 9000, argv: ['bash', '-l', '--session', U2] }) },
      okWire({ census: H + S(4242, { ppid: 9000 }) + T(1, 1) })
    )
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    // The child's own generation is the target: the shell's recorded argv is never consulted.
    expect(await t.locate(P('p1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
  })

  it('uses only the recorded root argv, never reconstructed census argv', async () => {
    // The root IS the cmd row but its recorded launch was a shell: unproven birth.
    const core = cmdCore({ t1: liveD({ pid: 4242, argv: ['bash', '-l'] }) }, okWire())
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate(P('p1'))).toBeNull()
    // Same for a retitled census row: the sampled argv is not launch-exact, so
    // a foreign-session seed inside it can never leak into the selection.
    const rt = cmdCore({ t1: liveD({ pid: 9000, argv: ['bash'], foreground: { pid: 4242 } }) }, {
      census: H + retitled(4242) + T(1, 1),
      files: filesWire([[F('a', U1), st(POSTOBS)], [F('r', U2), st(POST2)]]),
      headers: hdrs({ [F('a', U1)]: { st: st(POSTOBS), body: sess(U1) }, [F('r', U2)]: { st: st(POST2), body: sess(U2, OTHER) } })
    })
    const t2 = createCoreTranscripts({ call: rt.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t2.locate(P('p1'))).toEqual({ file: F('a', U1), session: U1, guessed: true }) // cwd file, never the resumed one
  })

  it('refuses two same-cwd cmd peers before any file IO', async () => {
    const core = cmdCore({ t1: liveD({ pid: 9000, foreground: { pid: 4242 } }) }, okWire({ census: H + S(4242) + S(5555) + T(2, 2) }))
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate(P('p1'))).toBeNull()
    expect([core.calls.census, core.calls.files, core.calls.headers]).toEqual([1, 0, 0])
  })

  it('passes process cwd evidence, never pane.cwd', async () => {
    const core = cmdCore({ t1: liveD({ pid: 9000, foreground: { pid: 4242 } }) }, okWire())
    const panes = [pane('p1', 't1', 'cmd', '/unrelated/pane-cwd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate({ id: 'p1', agent: 'cmd', cwd: '/unrelated/pane-cwd' })).toEqual({ file: F('a', U1), session: U1, guessed: true })
  })

  it('never resolves a finished or stateless terminal detail', async () => {
    const core = cmdCore({
      t1: liveD({ pid: 9000, foreground: { pid: 4242 } }),
      t2: { state: 'finished', pid: 9000, argv: ['cmd'], foreground: { pid: 4242 } },
      t3: { pid: 9000, argv: ['cmd'], foreground: { pid: 4242 } } // no state at all
    }, okWire())
    const panes = [pane('p1', 't1', 'cmd'), pane('p2', 't2', 'cmd'), pane('p3', 't3', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate(P('p1'))).not.toBeNull()
    const before = core.calls.census
    expect(await t.locate(P('p2'))).toBeNull()
    expect(await t.locate(P('p3'))).toBeNull()
    expect(core.calls.census).toBe(before) // state rejection precedes any evidence work
  })

  it('returns null on a failed or out-of-generation lookup — never the prior file', async () => {
    const cl = clock()
    const wires = okWire()
    const core = cmdCore({ t1: liveD({ pid: 9000, foreground: { pid: 4242 } }) }, wires)
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME, now: cl.now })
    expect(await t.locate(P('p1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
    cl.advance(2000) // evidence TTL expired: a fresh census decides again
    wires.census = 'H 100 1767225600 0\nT 0 0 0 0\n' // machine evidence unavailable
    expect(await t.locate(P('p1'))).toBeNull()
    expect(core.calls.census).toBe(3) // two-census window 1 + the failed c1
    cl.advance(2000)
    // The pid was reused by a NEW generation (ticks 45000, first observed at
    // the later coherent wall 1767226900.123): the POSTOBS write the old
    // generation could claim predates this generation's own bound.
    wires.census = H + S(4242, { ticks: '45000', up: '1300.12', wall: '1767226900.123' }) + T(1, 1)
    expect(await t.locate(P('p1'))).toBeNull()
    expect(core.calls.census).toBe(5)
  })

  it('waits for a post-observation write on a child target, then resolves it', async () => {
    // The M1 availability policy at the wrapper boundary: a child session
    // saved before our first observation stays unavailable until the NEXT
    // persisted write — null, then the same file resolves.
    const cl = clock()
    const wires = okWire({
      census: H + S(4242, { ppid: 9000 }) + T(1, 1),
      files: filesWire([[F('a', U1), st(GAP)]]),
      headers: hdrs({ [F('a', U1)]: { st: st(GAP), body: sess(U1) } })
    })
    const core = cmdCore({ t1: liveD({ pid: 9000, argv: ['bash', '-l'], foreground: { pid: 4242 } }) }, wires)
    const panes = [pane('p1', 't1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: HOME, now: cl.now })
    expect(await t.locate(P('p1'))).toBeNull()
    cl.advance(2000) // TTL expired: the persisted write is re-read
    wires.files = filesWire([[F('a', U1), st(POSTOBS)]])
    wires.headers = hdrs({ [F('a', U1)]: { st: st(POSTOBS), body: sess(U1) } })
    expect(await t.locate(P('p1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
  })

  it('drops any earlier legacy location so a later agent change cannot resurrect it', async () => {
    const core = cmdCore({ t1: liveD({ pid: 9000, foreground: { pid: 4242 } }) }, okWire())
    const p = pane('p1', 't1', 'cmd')
    const t = createCoreTranscripts({ call: core.call, pane: id => [p].find(q => q.id === id), localHome: HOME })
    expect(await t.locate(P('p1'))).not.toBeNull()
    ;(p as Pane).agent = 'claude' // the pane is relabeled: the cmd file must not leak back
    expect(await t.locate({ id: 'p1', agent: 'claude', cwd: WORK })).toBeNull()
  })

  it('keeps a failed machine at typed unavailable values and recovers on retry', async () => {
    let down = true
    const core = cmdCore({
      'box/t1': liveD({ pid: 9000, foreground: { pid: 4242 } }),
      'down/t1': liveD({ pid: 9000, foreground: { pid: 4242 } }),
      'down/t2': liveD({ pid: 9000, argv: ['claude'], foreground: { pid: 4242, name: 'claude', argv: ['claude'] } })
    }, okWire())
    const panes = [pane('r1', 'box/t1', 'cmd'), pane('r2', 'down/t1', 'cmd'), pane('r3', 'down/t2', 'claude')]
    const call = async (method: string, params: any): Promise<any> => {
      if (method === 'machine.exec' && params.on === 'down' && down) throw new CoreError('unreachable', 'machine is down')
      return core.call(method, params)
    }
    const t = createCoreTranscripts({ call, pane: id => panes.find(q => q.id === id), localHome: '/x' })
    const p2 = { id: 'r2', agent: 'cmd', cwd: WORK }
    // The home lookup fails inside the machine entry: every public read
    // resolves its own typed unavailable for cmd panes — no rejects.
    expect(await t.locate(p2)).toBeNull()
    expect(await t.preview(p2)).toBeNull()
    expect(await t.latestReply(p2)).toBeNull()
    expect(await t.model(p2)).toBeNull()
    expect(await t.pendingTool(p2)).toEqual([])
    expect(await t.pendingAsk(p2)).toEqual([])
    expect(await t.pendingClaudeQuestions(p2)).toEqual([])
    expect(await t.chat(p2)).toEqual({ available: false, reason: 'not_found' })
    expect(await t.search(p2, 'x', Date.now() + 1000)).toEqual({ hits: [], limited: false, kind: null })
    expect(await t.image(p2, 'f.jsonl', '0:1', 0)).toBeNull()
    // Legacy agents keep the throwing behavior on machine failure.
    await expect(t.locate({ id: 'r3', agent: 'claude', cwd: WORK })).rejects.toThrow()
    // A healthy machine stays isolated.
    expect(await t.locate(P('r1'))).toEqual({ file: F('a', U1), session: U1, guessed: true })
    // The failed entry is not pinned: once the machine answers, the same pane resolves.
    down = false
    expect(await t.locate(p2)).toEqual({ file: F('a', U1), session: U1, guessed: true })
  })

  it('without the callback a cmd pane resolves nothing and drops a seeded legacy location', async () => {
    const files: Record<string, string> = {
      '/h/.claude/sessions/7.json': JSON.stringify({ pid: 7, sessionId: 'sess-1', cwd: '/w' }),
      '/h/.claude/projects/-w/sess-1.jsonl': '{"type":"x"}\n'
    }
    const err = (code: string) => Object.assign(new Error(code), { code })
    let broken = false
    const fs: MachineFs = {
      stat: async p => { if (broken) throw err('EIO'); if (p in files) return { size: files[p]!.length, mtimeMs: 1, isFile: true, isDir: false }; throw err('ENOENT') },
      statMany: async ps => Promise.all(ps.map(p => fs.stat(p).catch(() => null))),
      readdir: async () => { throw err('ENOENT') },
      readFile: async p => { if (broken) throw err('EIO'); if (p in files) return files[p]!; throw err('ENOENT') },
      read: async (p, s, l) => { if (broken) throw err('EIO'); return Buffer.from(files[p] ?? '').subarray(s, s + l) }
    }
    const herdr = async (method: string) => {
      if (method === 'pane.process_info') return { process_info: { foreground_processes: [{ pid: 7, name: 'claude', argv: ['claude'] }] } }
      throw new Error('unsupported ' + method)
    }
    // No locateCommandCode: the pane's cmd branch must still clear — never serve legacy.
    const t = createTranscripts({ home: '/h', herdr: herdr as never, fs })
    expect(await t.locate({ id: 'p1', agent: 'claude', cwd: '/w' })).toEqual({ file: '/h/.claude/projects/-w/sess-1.jsonl', session: 'sess-1' })
    // The same pane id reports as cmd with no callback: null, and the seeded
    // legacy caches are dropped, not served (the session id even matched).
    expect(await t.locate({ id: 'p1', agent: 'cmd', cwd: '/w' })).toBeNull()
    // Back as claude with the filesystem now failing: nothing stale can answer.
    broken = true
    expect(await t.locate({ id: 'p1', agent: 'claude', cwd: '/w' })).toBeNull()
  })

  it('coalesces one machine snapshot across simultaneous pane lookups', async () => {
    const core = cmdCore({
      'box/t1': liveD({ pid: 9000, foreground: { pid: 4242 } }),
      'box/t2': liveD({ pid: 9001, foreground: { pid: 5555 } }),
      'box/t3': liveD({ pid: 9999, argv: ['bash'] })
    }, {
      census: H + S(4242) + S(5555, { cwd: '/w/two' }) + T(2, 2),
      files: filesWire([[F('a', U1), st(POSTOBS)], [F('b', U2), st(POST2)]]),
      headers: hdrs({ [F('a', U1)]: { st: st(POSTOBS), body: sess(U1) }, [F('b', U2)]: { st: st(POST2), body: sess(U2, '/w/two') } })
    })
    const panes = [pane('p1', 'box/t1', 'cmd'), pane('p2', 'box/t2', 'cmd'), pane('p3', 'box/t3', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: '/unrelated' })
    const [r1, r2, r3, pv, md] = await Promise.all([
      t.locate(P('p1')),
      t.locate({ id: 'p2', agent: 'cmd', cwd: '/w/two' }),
      t.locate(P('p3')),
      t.preview(P('p1')),
      // model() is enabled for cmd: a dead remote stat is a read error the
      // caller sees, not "no model" — the wire here answers unreachable.
      t.model(P('p1')).then(() => null, (e: unknown) => e)
    ])
    expect(r1).toEqual({ file: F('a', U1), session: U1, guessed: true })
    expect(r2).toEqual({ file: F('b', U2), session: U2, guessed: true })
    expect(r3).toBeNull() // unproven root: no location, no storm
    expect(pv).toBeNull() // guarded chat can't stat the dead remote either
    expect(md).toBeInstanceOf(Error)
    expect([core.calls.census, core.calls.files, core.calls.headers]).toEqual([2, 1, 1])
  })

  it('refuses a failed home reply and never reaches census or file select', async () => {
    // A nonzero code or a timeout can carry a plausible absolute partial —
    // it is never a trusted home, so nothing after it may run.
    for (const bad of [
      { code: 1, stdout: Buffer.from('/h/.commandcode').toString('base64') },
      { timed_out: true, stdout: Buffer.from('/h/.com').toString('base64') },
    ]) {
      const execs: string[] = []
      const call = async (method: string, params: { argv?: string[] }): Promise<any> => {
        if (method === 'terminal.get') return liveD({ pid: 9000, argv: ['bash'], foreground: { pid: 4242 } })
        if (method === 'machine.exec') { execs.push(String(params.argv?.[2] || '')); return bad }
        throw new CoreError('rpc', method)
      }
      const panes = [pane('r1', 'box/t1', 'cmd')]
      const t = createCoreTranscripts({ call, pane: id => panes.find(p => p.id === id), localHome: HOME })
      expect(await t.locate(P('r1'))).toBeNull()
      expect(execs).toEqual(['printf %s "$HOME"'])
    }
  })

  it('uses a valid trailing-space home literally, never trimmed away', async () => {
    const LITERAL = '/h '
    const file = `${LITERAL}/.commandcode/projects/a/${U1}.jsonl`
    const core = cmdCore(
      { 'box/t1': liveD({ pid: 9000, argv: ['bash'], foreground: { pid: 4242 } }) },
      {
        census: H + S(4242) + T(1, 1),
        files: filesWire([[file, st(POSTOBS)]]),
        headers: hdrs({ [file]: { st: st(POSTOBS), body: sess(U1) } }),
      },
      { home: LITERAL }
    )
    const panes = [pane('r1', 'box/t1', 'cmd')]
    const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: '/unrelated' })
    expect(await t.locate(P('r1'))).toEqual({ file, session: U1, guessed: true })
  })

  it('rejects home bytes that cannot decode back to themselves', async () => {
    // Invalid UTF-8 would be replaced into ANOTHER path, never an option.
    const execs: string[] = []
    const call = async (method: string, params: { argv?: string[] }): Promise<any> => {
      if (method === 'terminal.get') return liveD({ pid: 9000, argv: ['bash'], foreground: { pid: 4242 } })
      if (method === 'machine.exec') {
        execs.push(String(params.argv?.[2] || ''))
        return { code: 0, stdout: Buffer.from([0x2f, 0x68, 0xff]).toString('base64') } // '/h\xff'
      }
      throw new CoreError('rpc', method)
    }
    const panes = [pane('r1', 'box/t1', 'cmd')]
    const t = createCoreTranscripts({ call, pane: id => panes.find(p => p.id === id), localHome: HOME })
    expect(await t.locate(P('r1'))).toBeNull()
    expect(execs).toEqual(['printf %s "$HOME"'])
  })

  it('rejects a non-absolute or NUL-bearing local home for a local pane', async () => {
    for (const bad of ['rel/home', '/h\0idden']) {
      const core = cmdCore({ t1: liveD({ pid: 9000, argv: ['bash'], foreground: { pid: 4242 } }) }, okWire())
      const panes = [pane('p1', 't1', 'cmd')]
      const t = createCoreTranscripts({ call: core.call, pane: id => panes.find(p => p.id === id), localHome: bad })
      expect(await t.locate(P('p1'))).toBeNull()
      expect(core.calls.exec.length).toBe(0) // nothing ran on a guessed home
      expect(core.calls.get.length).toBe(0)
    }
  })

  // Reply revalidation dispatches only for Command Code: other agents
  // answer null without touching any machine; a Command Code available
  // reply on a cold machine fails closed (a bound reply must exist
  // somewhere), and its unbound verdict is 'gone', never 'ok'.
  it('gates reply revalidation to Command Code: legacy null, cold Cmd closed', async () => {
    const core = cmdCore({}, {})
    const t = createCoreTranscripts({ call: core.call, pane: () => undefined, localHome: HOME })
    const other = { id: 'x', agent: 'claude', cwd: WORK } as TranscriptPane
    const avail = { available: true, file: 'x.jsonl' } as ChatResponse
    expect(await t.current(other, avail)).toBeNull()
    expect(t.live(other, avail)).toBeNull()
    expect(core.calls.get).toEqual([]) // no terminal.get, no machine.exec
    expect(core.calls.exec).toEqual([])
    expect(await t.current(P('c1'), avail)).toBe('gone')
    expect(t.live(P('c1'), avail)).toBe(false)
  })
})

const FILE = '/home/alice/.commandcode/projects/-w/s1.jsonl'
const PANE: TranscriptPane = { id: 'p1', agent: 'cmd', cwd: '/w' }
const PANE2: TranscriptPane = { id: 'p2', agent: 'cmd', cwd: '/w' }
const noHerdr = (async () => { throw new Error('no Herdr') }) as never
const body = (...l: unknown[]) => Buffer.from(J(...l) + '\n')
const call = (id = 't1', ms = 5) => assistant('a1', [{ type: 'tool_use', id, name: 'read_file', input: {} }], ms)
const out = (id: string, content: unknown, ms = 10, tid = 't1') => results(id, [{ tool_use_id: tid, content }], ms)

const mk = (disk: Record<string, MemFile>, io?: MemIo) => createTranscripts({
  home: '/h', herdr: noHerdr, fs: memFs(disk, io),
  locateCommandCode: async () => ({ file: FILE, session: 's1' }),
})
const poll = (t: ReturnType<typeof createTranscripts>, token: string | undefined, from: number | undefined, pane = PANE) =>
  t.chat(pane, { since: token, from, anchor: token })
const stampOf = (token?: string) => /~s(\d+)~r/.exec(token ?? '')?.[1] ?? null

describe('Command Code reader', () => {
  it('serves a conversation, reports a cross-page outcome as toolUpdates, and applies it on the older page', async () => {
    const u2 = user('u2', 'while it runs', 8)
    const v1 = body(psess('s1'), user('u1', 'q', 1), call(), u2)
    const offU2 = Buffer.byteLength(J(psess('s1'), user('u1', 'q', 1), call()) + '\n')
    const disk = { [FILE]: { body: v1 } }
    const t = mk(disk)
    const r1 = await t.chat(PANE, {})
    expect(r1).toMatchObject({ available: true, file: 's1.jsonl', session: 's1' })
    expect(r1.token).toMatch(/~s\d+~r[a-z0-9]+\//)
    expect(r1.items!.map(i => i.role)).toEqual(['user', 'tool', 'user'])
    const res = out('r1', 'found it')
    disk[FILE].body = Buffer.concat([v1, Buffer.from(JSON.stringify(res) + '\n')])
    // The client's window starts below the call: the result is an orphan in
    // this parse — its update reports on the wire for the older page.
    const r2 = await poll(t, r1.token, offU2)
    expect(r2.toolUpdates).toEqual([{ id: 't1', at: v1.length, out: 'found it', error: false, images: 0, ref: '', imageAt: 0 }])
    expect(r2.items!.map(i => i.role)).toEqual(['user'])
    // The older page's call shows the shared outcome — cross-page through the
    // generation's map, not a re-parse of the result.
    const old = await t.chat(PANE, { before: offU2, since: r2.token })
    expect(old.older).toBe(true)
    expect(old.items!.find(i => i.toolId === 't1')).toMatchObject({ out: 'found it' })
  })

  // Review finding 1: an older page awaited across another client's observed
  // rewrite is a different transcript's — never returned.
  it('rejects an older page whose generation moved while its windows were awaited', async () => {
    const v1 = body(psess('s1'), user('u1', 'one', 1), user('u2', 'two', 2), user('u3', 'three', 3))
    const offU3 = Buffer.byteLength(J(psess('s1'), user('u1', 'one', 1), user('u2', 'two', 2)) + '\n')
    const disk = { [FILE]: { body: v1 } }
    const gate = defer()
    const entered = defer()
    let arm = false
    const io: MemIo = {
      onRead: async (start, len) => {
        // Captured BEFORE the gate: what resolves is genuinely the old bytes.
        const snap = disk[FILE].body.subarray(start, start + len)
        if (arm) { arm = false; entered.resolve(); await gate.promise }
        return snap
      },
    }
    const t = mk(disk, io)
    const first = await t.chat(PANE, {})
    arm = true
    const aP = t.chat(PANE, { before: offU3, since: first.token })
    await entered.promise
    // B observes an in-place rewrite while A's window pends — same session
    // file, new content (a /clear would be another file, not a header swap).
    disk[FILE] = { body: body(psess('s1'), user('u9', 'different session', 1)), mtimeMs: 9 }
    const b = await t.chat(PANE2, {})
    expect(b.items!.some(i => i.text === 'different session')).toBe(true)
    gate.resolve()
    await expect(aP).rejects.toThrow('read unknown')
    // B's next poll keeps its generation — A's stale read reached nothing.
    const again = await poll(t, b.token, b.start, PANE2)
    expect(again.rewritten).toBeUndefined()
  })

  // Review finding 2: a stale awaited read must never feed the retained
  // parser nor overwrite the fresh generation's Below after a purge.
  it('a stale awaited read cannot republish a Below over the fresh generation', async () => {
    const pad = 'x'.repeat(9 * 1024)
    const v1 = body(psess('s1'), call(), out('r1', 'old outcome'))
    const disk = { [FILE]: { body: v1 } }
    const gate = defer()
    const entered = defer()
    let arm = false
    const reads: { start: number, len: number }[] = []
    const io: MemIo = {
      reads,
      onRead: async (start, len) => {
        const snap = disk[FILE].body.subarray(start, start + len)
        if (arm) { arm = false; entered.resolve(); await gate.promise }
        return snap
      },
    }
    const t = mk(disk, io)
    const r1 = await t.chat(PANE, {})
    // A's incremental poll pends on the Below rebuild read.
    arm = true
    const aP = poll(t, r1.token, r1.start)
    await entered.promise
    // Another same-generation request on the same cursor: a grown file gives
    // it a different tail flight, so it reaches the bottom mutex and queues
    // behind A — still the old stamp.
    const queued = defer()
    disk[FILE].body = Buffer.concat([v1, Buffer.from(J(user('u1b', 'still old', 15)) + '\n')])
    io.onRead = () => { queued.resolve() }
    const aP2 = poll(t, r1.token, r1.start)
    await queued.promise
    // Let its whole microtask chain drain: `handle` binds while S1 is live,
    // then it sits on A's mutex — a genuinely stale request at the door.
    await new Promise(setImmediate)
    // B observes the rewrite, then builds its fresh retained bottom at the
    // same cursor key A is about to republish under.
    // In-place rewrite of the same session file: s1.jsonl keeps its own
    // header — replacing its id would simulate a different file (/clear).
    const v2 = body(psess('s1'), user('u2', pad, 1), call('t2'), out('r2', 'new outcome', 10, 't2'))
    disk[FILE] = { body: v2, mtimeMs: 9 }
    const b2 = await t.chat(PANE2, {})
    const fresh = await poll(t, b2.token, b2.start, PANE2)
    expect(fresh.items!.find(i => i.toolId === 't2')).toMatchObject({ out: 'new outcome' })
    gate.resolve()
    await expect(aP).rejects.toThrow('read unknown')
    // The queued stale request must reject at the door — never delete the
    // fresh entry before its own readExact can reject on the dead stamp.
    await expect(aP2).rejects.toThrow('generation changed')
    // Append on the fresh generation: B's retained bottom (with its >4 KiB
    // history) checks continuity by the two-read span — a destroyed-and-
    // rebuilt bottom would have been one read from the cursor's anchor.
    const extra = Buffer.from(J(user('u3', 'more', 30)) + '\n')
    const size = v2.length + extra.length
    disk[FILE].body = Buffer.concat([v2, extra])
    reads.length = 0
    const r3 = await poll(t, fresh.token, fresh.start, PANE2)
    expect(r3.rewritten).toBeUndefined()
    expect(r3.items!.some(i => i.text === 'more')).toBe(true)
    expect(r3.items!.find(i => i.toolId === 't2')).toMatchObject({ out: 'new outcome' })
    expect(stampOf(r3.token)).toBe(stampOf(b2.token))
    // The retained bottom's two-read continuity pattern (above + tail from
    // `end - CHECK_BYTES`), never A's stale one-read rebuild.
    expect(reads.some(r => r.start > 0 && r.start < size && r.start + r.len === size)).toBe(true)
    expect(reads.some(r => r.start === 0 && r.len === size)).toBe(false)
  })

  // Review finding 3: a short Below read is unknown coverage, not proof of a
  // rewrite — no epoch advance, no map loss, no false rewritten.
  it('a short retained-bottom read rejects without invalidating and the same generation recovers', async () => {
    const v1 = body(psess('s1'), call(), out('r1', 'kept'))
    const disk = { [FILE]: { body: v1 } }
    let short = false
    const io: MemIo = {
      // Only the full-span Below read (from the anchor at 0) goes short —
      // the observation's watch-span read stays whole.
      onRead: (start, len) =>
        short && start === 0 && len === disk[FILE].body.length ? disk[FILE].body.subarray(0, len - 20) : undefined,
    }
    const t = mk(disk, io)
    const r1 = await t.chat(PANE, {})
    await poll(t, r1.token, r1.start) // retains the Below
    disk[FILE].body = Buffer.concat([v1, Buffer.from(J(user('u2', 'appended', 20)) + '\n')])
    short = true
    // The body covers all of above/known but drops the end of the new tail:
    // unknown coverage — never a rewrite, never a cacheable partial page.
    await expect(poll(t, r1.token, r1.start)).rejects.toThrow('read unknown')
    short = false
    const r4 = await poll(t, r1.token, r1.start)
    expect(r4.rewritten).toBeUndefined()
    expect(stampOf(r4.token)).toBe(stampOf(r1.token)) // no epoch advance
    expect(r4.items!.some(i => i.text === 'appended')).toBe(true)
    expect(r4.items!.find(i => i.toolId === 't1')).toMatchObject({ out: 'kept' }) // outcome map intact
  })

  // Review finding 4: a valid unterminated line whose whole-bottom read
  // fails must reject — never fall back to the stale retained items.
  it('a short initial backward read is unknown — rejects, and a retry serves the whole file', async () => {
    const v1 = body(psess('s1'), user('u1', 'hello', 1), call())
    const disk = { [FILE]: { body: v1 } }
    let short = false
    const t = mk(disk, { onRead: (start, len) => short ? disk[FILE].body.subarray(start, start + Math.max(0, len - 40)) : undefined })
    short = true
    await expect(t.chat(PANE, {})).rejects.toThrow('read unknown')
    short = false
    const r = await t.chat(PANE, {})
    expect(r.items!.some(i => i.toolId === 't1')).toBe(true)
    // Nothing was cached as the full size: the token is a fresh, current one.
    const again = await poll(t, r.token, r.start)
    expect(again.items!.some(i => i.toolId === 't1')).toBe(true)
  })

  // Review finding 4: a complete JSON line without its newline takes the
  // whole-bottom readSlice — the SECOND read of this poll. The first (the
  // retained bottom's raw span) must see the valid line; only the slice
  // read fails, and its IO failure surfaces — never stale items.
  it('rejects when the whole-bottom slice read fails, then serves the line on the next poll', async () => {
    const whole = J(psess('s1'), user('u1', 'one', 1)) + '\n'
    const tail = JSON.stringify(user('u2', 'tail message', 2))
    const disk = { [FILE]: { body: Buffer.from(whole + tail) } }
    let n = 0
    let fail = false
    const t = mk(disk, { onRead: () => { if (fail && ++n === 2) throw new Error('slice read broke') } })
    const r1 = await t.chat(PANE, {})
    fail = true
    // n=1: the Below's raw span returns the appended unterminated line;
    // n=2: readSlice's whole-bottom read fails — the request rejects.
    await expect(poll(t, r1.token, r1.start)).rejects.toThrow('read unknown')
    fail = false
    // No new disk write: the same line is served from the same bytes.
    const r3 = await poll(t, r1.token, r1.start)
    expect(r3.items!.some(i => i.text === 'tail message')).toBe(true)
  })

  // Review finding 5: the backward reader never issues a window past the
  // remaining MAX_READ_BYTES span — a 25 MiB line is not parsed by overshoot.
  it('never reads past the remaining span — a line beyond the cap is not parsed', async () => {
    const CAP = 24 * 1024 * 1024
    const pre = body(psess('s1'))
    const disk = { [FILE]: { body: Buffer.concat([pre, Buffer.alloc(25 * 1024 * 1024, 120), Buffer.from('\n')]) } }
    const lens: { start: number, len: number }[] = []
    const t = mk(disk, { onRead: (start, len) => { lens.push({ start, len }) } })
    const r = await t.chat(PANE, {})
    expect(r.items).toEqual([])
    // Every issued window stays within the cap: the largest logical span is
    // 24 MiB — each read may ask one extra lookback byte for the line-start
    // check, and widening re-reads overlap, so bytes transferred can be more.
    expect(Math.max(...lens.map(x => x.len))).toBeLessThanOrEqual(CAP + 1)
    expect(Math.min(...lens.map(x => x.start))).toBeGreaterThanOrEqual(disk[FILE].body.length - CAP - 1)
  })

  // Reply contexts are reader-local: a reply bound by another
  // createTranscripts — or no reader at all — can never authorize through
  // this one. An available Command Code reply whose context is unknown
  // fails closed; other agents keep "nothing to check".
  it('never authorizes a reply bound by a foreign or unknown reader', async () => {
    const FILE2 = '/home/alice/.commandcode/projects/-w/s2.jsonl'
    const disk = { [FILE]: { body: body(psess('s1'), user('u1', 'q', 1)) }, [FILE2]: { body: body(psess('s2'), user('u2', 'q', 1)) } }
    const locate = async (): Promise<Loc | null> => ({ file: FILE, session: 's1' })
    const t1 = createTranscripts({ home: '/h', herdr: noHerdr, fs: memFs(disk), locateCommandCode: locate })
    const t2 = createTranscripts({ home: '/h', herdr: noHerdr, fs: memFs(disk), locateCommandCode: locate })
    const r2 = await t2.chat(PANE, {}) // same file, same stamp numbers
    expect(await t1.current(PANE, r2)).toBe('gone')
    expect(t1.live(PANE, r2)).toBe(false)
    const r1 = await t1.chat(PANE, {})
    expect(await t1.current(PANE, r1)).toBe('ok')
    expect(t1.live(PANE, r1)).toBe(true)
    const bare = { available: true, file: 'x.jsonl' } as ChatResponse
    expect(await t1.current(PANE, bare)).toBe('gone')
    expect(t1.live(PANE, bare)).toBe(false)
    const other: TranscriptPane = { id: 'p9', agent: 'claude', cwd: '/w' }
    expect(await t1.current(other, bare)).toBeNull()
    expect(t1.live(other, bare)).toBeNull()
  })

  // A lookup started before forget holds a ticket that can never be
  // reissued: its late FILE1 answer cannot overwrite the newer FILE2
  // observation. With selection evidence unknown (post-forget) a bound
  // reply fails closed — FILE1's stamp stays live throughout (its
  // generation was never invalidated), so the selection guard is what
  // keeps it unpublishable.
  it('keeps a bound reply unpublishable through forget and a late stale lookup', async () => {
    const FILE2 = '/home/alice/.commandcode/projects/-w/s2.jsonl'
    const disk = { [FILE]: { body: body(psess('s1'), user('u1', 'q', 1)) }, [FILE2]: { body: body(psess('s2'), user('u2', 'q', 1)) } }
    let cur: Loc | null = { file: FILE, session: 's1' }
    let gated = false
    const started = defer()
    const g = defer()
    const t = createTranscripts({
      home: '/h', herdr: noHerdr, fs: memFs(disk),
      locateCommandCode: async () => { if (gated) { started.resolve(); await g.promise; return { file: FILE, session: 's1' } } return cur },
    })
    const rA = await t.chat(PANE, {})
    expect(t.live(PANE, rA)).toBe(true)
    gated = true
    const old = t.locate(PANE) // a lookup that started before forget
    await started.promise
    t.forget('p1')
    expect(t.live(PANE, rA)).toBe(false) // selection evidence unknown: closed
    gated = false
    cur = { file: FILE2, session: 's2' }
    await t.locate(PANE) // the newer lookup observes FILE2
    g.resolve()
    expect(await old).toEqual({ file: FILE, session: 's1' })
    expect(t.live(PANE, rA)).toBe(false) // the late FILE1 never overwrote FILE2
  })

  // A result older than the window reports as a toolUpdates revision —
  // images and the record's own ref included — and a later empty success
  // clears the outcome instead of preserving it. An older page that
  // re-parses the superseded record can never downgrade the shared map:
  // the newest absolute revision wins whichever order pages arrived in.
  it('carries a late image outcome, then an empty success clears it — an older page cannot downgrade', async () => {
    const ownImg = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(9000) } }
    const resImg = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'B'.repeat(9000) } }
    const u2 = user('u2', 'while it runs', 8)
    const v1 = body(psess('s1'), user('u1', 'q', 1), call(), u2)
    const offU2 = Buffer.byteLength(J(psess('s1'), user('u1', 'q', 1), call()) + '\n')
    const disk = { [FILE]: { body: v1 } }
    const t = mk(disk)
    const r1 = await t.chat(PANE, {})
    // One own image before the result's: the result's image is imageAt 1.
    const res1 = JSON.stringify({
      type: 'message', id: 'r1', parentId: null, timestamp: at(10),
      message: { role: 'user', meta: { source: 'tool', createdAt: 1700000000010 },
        content: [ownImg, { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'first' }, resImg] }] },
    })
    const res1Off = v1.length
    const res1Len = Buffer.byteLength(res1)
    disk[FILE].body = Buffer.concat([v1, Buffer.from(res1 + '\n')])
    const r2 = await poll(t, r1.token, offU2)
    expect(r2.toolUpdates).toEqual([{ id: 't1', at: res1Off, out: 'first', error: false, images: 1, ref: `${res1Off}:${res1Len}`, imageAt: 1 }])
    // The update's own ref+imageAt publicly selects the RESULT's image
    // bytes, not the own image the line carried before it.
    const picked = await t.image(PANE, r2.file!, r2.toolUpdates![0]!.ref!, r2.toolUpdates![0]!.imageAt)
    expect(picked).toMatchObject({ type: 'image/png' })
    expect(picked!.body).toEqual(Buffer.from('B'.repeat(9000), 'base64'))
    // The result directly before the empty success carries BOTH error and
    // image — the later clear then proves removal, not absence.
    const res2 = JSON.stringify({
      type: 'message', id: 'r2', parentId: null, timestamp: at(11),
      message: { role: 'user', meta: { source: 'tool', createdAt: 1700000000011 },
        content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'boom' }, resImg] }] },
    })
    const res2Off = res1Off + res1Len + 1
    const res2Len = Buffer.byteLength(res2)
    disk[FILE].body = Buffer.concat([disk[FILE].body, Buffer.from(res2 + '\n')])
    const r3 = await poll(t, r2.token, offU2)
    expect(r3.toolUpdates).toEqual([{ id: 't1', at: res2Off, out: 'boom', error: true, images: 1, ref: `${res2Off}:${res2Len}`, imageAt: 0 }])
    // The older page re-parses res1's record but the shared map keeps res2.
    const old = await t.chat(PANE, { before: res2Off, since: r3.token })
    expect(old.older).toBe(true)
    const callItem = old.items!.find(i => i.toolId === 't1')!
    expect(callItem).toMatchObject({ out: 'boom', error: true, images: 1, ref: `${res2Off}:${res2Len}` })
    // An empty success is a complete replacement: it clears, not preserves.
    const res3 = out('r3', '', 12)
    disk[FILE].body = Buffer.concat([disk[FILE].body, Buffer.from(JSON.stringify(res3) + '\n')])
    const r4 = await poll(t, r3.token, offU2)
    expect(r4.toolUpdates).toEqual([{ id: 't1', at: res2Off + res2Len + 1, out: '', error: false, images: 0, ref: '', imageAt: 0 }])
    const old2 = await t.chat(PANE, { before: res2Off, since: r4.token })
    const cleared = old2.items!.find(i => i.toolId === 't1')!
    expect(cleared.out).toBeUndefined()
    expect(cleared.error).toBeUndefined()
    expect(cleared.images).toBeUndefined()
    expect(cleared.ref).toBeUndefined()
    expect(cleared.imageAt).toBeUndefined()
    expect(cleared.hashes).toBeUndefined()
  })

  // The retained bottom is incremental: appended lines parse alone — an
  // old record is never JSON-parsed again — and a record whose newline has
  // not landed waits for the next poll.
  it('parses only appended lines, and a partial record completes next poll', async () => {
    const v1 = body(psess('s1'), user('u1', 'uniq-marker-1', 1))
    const disk = { [FILE]: { body: v1 } }
    const t = mk(disk)
    // An explicit cursor warms the retained bottom (a null `from` walks
    // backwards and retains nothing): later polls feed appends only.
    const r1 = await t.chat(PANE, { from: 0 })
    const spy = vi.spyOn(JSON, 'parse')
    try {
      const u2 = JSON.stringify(user('u2', 'second', 2))
      disk[FILE].body = Buffer.concat([v1, Buffer.from(u2 + '\n')])
      const r2 = await poll(t, r1.token, r1.start)
      expect(r2.items!.some(i => i.text === 'second')).toBe(true)
      // The marker lives inside the first record: re-parsing it would show.
      expect(spy.mock.calls.filter(c => String(c[0]).includes('uniq-marker-1'))).toEqual([])
      const u3 = JSON.stringify(user('u3', 'partial-xy', 3))
      disk[FILE].body = Buffer.concat([disk[FILE].body, Buffer.from(u3.slice(0, 30))])
      const r3 = await poll(t, r2.token, r1.start)
      expect(r3.items!.some(i => i.text === 'partial-xy')).toBe(false)
      disk[FILE].body = Buffer.concat([disk[FILE].body, Buffer.from(u3.slice(30) + '\n')])
      const r4 = await poll(t, r3.token, r1.start)
      expect(r4.items!.some(i => i.text === 'partial-xy')).toBe(true)
    } finally { spy.mockRestore() }
  })

  // Every public reset shape reaches the same contract: the stale token
  // answers a rewritten fresh bottom — never older:true — under a new stamp.
  it('resets public clients on truncate, inode, same-size rewrite and a watched-result edit', async () => {
    const v1 = body(psess('s1'), user('u1', 'q', 1), call(), out('r1', 'watched'), user('u2', 'tail one', 12))
    const disk: Record<string, MemFile> = { [FILE]: { body: v1 } }
    const t = mk(disk)
    let r = await t.chat(PANE, {})
    let prevStamp = stampOf(r.token)
    const fresh = async (want: { text?: string, out?: string }) => {
      r = await poll(t, r.token, r.start)
      expect(r.rewritten).toBe(true)
      expect(r.older).toBeUndefined()
      // Each reset mints a new positive stamp — an anchor-only client reset
      // could not mask a missing cross-client generation invalidation.
      const stamp = Number(stampOf(r.token))
      expect(stamp).toBeGreaterThan(Number(prevStamp))
      prevStamp = stampOf(r.token)
      if (want.text !== undefined) expect(r.items!.some(i => i.text === want.text)).toBe(true)
      if (want.out !== undefined) expect(r.items!.find(i => i.toolId === 't1')).toMatchObject({ out: want.out })
    }
    // Shorter than the generation's trusted size (the client's from cursor
    // is 0 — the file is still longer than it): reset.
    disk[FILE] = { body: v1.subarray(0, v1.length - 30), mtimeMs: 5 }
    await fresh({ text: 'q' })
    // Same bytes under another inode: another file's generation.
    disk[FILE] = { body: v1, mtimeMs: 5, ino: 4242 }
    await fresh({ out: 'watched' })
    // Same size, same inode, same session header, different content — the
    // realistic rewrite shape: content identity wins, not the header.
    const v2 = body(psess('s1'), user('u1', 'q', 1), call(), out('r1', 'watched'), user('u2', 'tail two', 12))
    expect(v2.length).toBe(v1.length)
    disk[FILE] = { body: v2, mtimeMs: 9, ino: 4242 }
    await fresh({ text: 'tail two' })
    // Same inode again: an in-place edit of a watched result record plus
    // growth — the result watch catches what a pure size check cannot.
    const resOff = Buffer.byteLength(J(psess('s1'), user('u1', 'q', 1), call()) + '\n')
    const resLine = Buffer.byteLength(JSON.stringify(out('r1', 'watched')))
    const edited = Buffer.from(JSON.stringify(out('r1', 'xatched')) + '\n')
    expect(edited.length).toBe(resLine + 1)
    disk[FILE] = { body: Buffer.concat([v2.subarray(0, resOff), edited, v2.subarray(resOff + resLine + 1), Buffer.from(J(user('u3', 'appended', 15)) + '\n')]), mtimeMs: 12, ino: 4242 }
    await fresh({ out: 'xatched' })
  })

  // One client's stale proof cannot regress another client's state: an old
  // token replays into a fresh bottom of the CURRENT generation — it mints
  // nothing and never serves older:true. The remembered outcome must
  // survive the replay itself: the shared map's NEWER result sits outside
  // the fresh bottom's window, so the response can only carry it from the
  // map, not from re-parsing the record — and an older page ending before
  // it still shows it over the page's own older result. The raw anchor
  // alone (since forgotten) is no better proof.
  it('a stale token cannot downgrade another client nor mint a generation', async () => {
    const callLine = call()
    const rold = out('rold', 'old out', 8)
    const rnew = out('rnew', 'new out', 9)
    const roldOff = Buffer.byteLength(J(psess('s1'), user('u1', 'q', 1), callLine) + '\n')
    const rnewOff = roldOff + Buffer.byteLength(JSON.stringify(rold)) + 1
    const v1 = body(psess('s1'), user('u1', 'q', 1), callLine, rold, rnew)
    const reads: { start: number, len: number }[] = []
    const disk: Record<string, MemFile> = { [FILE]: { body: v1 } }
    const t = mk(disk, { reads })
    // A's token belongs to the previous generation: same-size rewrite.
    const rA = await t.chat(PANE, {})
    const v2 = body(psess('s1'), user('u1', 'w', 1), callLine, rold, rnew)
    expect(v2.length).toBe(v1.length)
    disk[FILE] = { body: v2, mtimeMs: 9 }
    // B learns 'new out' into the current generation while the file is small.
    const rB = await t.chat(PANE2, {})
    expect(stampOf(rB.token)).not.toBe(stampOf(rA.token))
    // A visible tail of distinct items, both deeper than one bottom window
    // and dense enough that its last slice is already a full bottom: the
    // remembered result now sits outside what a fresh bottom reaches.
    const tail = Buffer.from(Array.from({ length: 160 }, (_, i) => J(user(`t${i}`, `tail ${i} ` + 'x'.repeat(14 * 1024), 20 + i))).join('\n') + '\n')
    disk[FILE].body = Buffer.concat([v2, tail])
    const b2 = await poll(t, rB.token, rB.start, PANE2)
    expect(b2.rewritten).toBeUndefined()
    expect(stampOf(b2.token)).toBe(stampOf(rB.token)) // growth mints nothing
    // No disk mutation: A's stale replay serves the current generation's
    // fresh bottom — it must mint nothing and must not re-read 'rnew'.
    const spy = vi.spyOn(JSON, 'parse')
    const rnewParses = () => spy.mock.calls.filter(c => String(c[0]).includes('"id":"rnew"')).length
    spy.mockClear()
    reads.length = 0
    const a2 = await t.chat(PANE, { anchor: rA.token, from: rA.start })
    expect(a2.rewritten).toBe(true)
    expect(a2.older).toBeUndefined()
    expect(stampOf(a2.token)).toBe(stampOf(b2.token)) // same generation, not a new one
    expect(rnewParses()).toBe(0)
    // Geometry: every content window began after the remembered record
    // (only the session probe may read from 0), and the bottom's items are
    // all from the tail — never u1, the call or either result.
    expect(reads.filter(r => r.start > 0).every(r => r.start >= rnewOff + Buffer.byteLength(JSON.stringify(rnew)) + 1)).toBe(true)
    expect(a2.items!.some(i => i.toolId === 't1')).toBe(false)
    expect(a2.items!.some(i => i.text === 'w')).toBe(false)
    // An older page ending BEFORE rnew but covering the call and rold: the
    // page's own parse offers 'old out' — the remembered map still wins.
    const old = await t.chat(PANE, { before: rnewOff, since: a2.token })
    expect(old.older).toBe(true)
    expect(old.items!.find(i => i.toolId === 't1')).toMatchObject({ out: 'new out' })
    // The raw anchor alone (since forgotten) is no better proof: same fresh
    // bottom, never an older page.
    const a3 = await t.chat(PANE, { before: rnewOff, anchor: rA.token })
    expect(a3.older).toBeUndefined()
    expect(a3.rewritten).toBe(true)
    spy.mockRestore()
  })

  // A reader restart drops every map: the nonce in new tokens differs and a
  // token of the previous process is foreign proof. The file table is
  // bounded at 64: the oldest file's record evicts, so its next read mints
  // a new stamp — an unrelated still-retained file stays current.
  it('changes the reader nonce on restart and the stamp past the 64-file bound', async () => {
    const v1 = body(psess('s1'), user('u1', 'q', 1))
    const disk = { [FILE]: { body: v1 } }
    const t1 = mk(disk)
    const r1 = await t1.chat(PANE, {})
    const t2 = mk(disk)
    const r2 = await t2.chat(PANE, {})
    expect(/~r([a-z0-9]+)/.exec(r2.token!)![1]).not.toBe(/~r([a-z0-9]+)/.exec(r1.token!)![1])
    const stale = await poll(t2, r1.token, r1.start)
    expect(stale.rewritten).toBe(true) // the old process's proof is foreign
    // Sixty-five distinct files through the real table: ev1 evicts.
    const many: Record<string, MemFile> = {}
    const pathOf = (id: string) => `/home/alice/.commandcode/projects/-w/${id}.jsonl`
    for (let i = 1; i <= 65; i++) many[pathOf(`e${i}`)] = { body: body(psess(`e${i}`), user(`u${i}`, `file ${i}`, 1)) }
    const t3 = createTranscripts({
      home: '/h', herdr: noHerdr, fs: memFs(many),
      locateCommandCode: async p => ({ file: pathOf(p.id), session: p.id }),
    })
    const kept = new Map<string, string>()
    const evPane = (id: string): TranscriptPane => ({ id, agent: 'cmd', cwd: '/w' })
    for (let i = 1; i <= 65; i++) {
      const r = await t3.chat(evPane(`e${i}`), {})
      kept.set(`e${i}`, r.token!)
    }
    const evicted = await t3.chat(evPane('e1'), { since: kept.get('e1')!, anchor: kept.get('e1')! })
    expect(evicted.rewritten).toBe(true)
    const current = await t3.chat(evPane('e40'), { since: kept.get('e40')!, anchor: kept.get('e40')! })
    expect(current.unchanged).toBe(true)
  })

  // A backward window whose raw buffer begins inside a large preceding
  // record: the result after it is the first parsed line of a buffer that
  // starts BEFORE it — its watch must fingerprint the real record bytes,
  // not an offset shifted to the aligned start. A second client whose list
  // starts past the 9-KiB pad can never re-check those bytes (its 4-KiB
  // anchor and its retained check cover the tail only): growth keeps its
  // stamp — a fingerprint based on the aligned start instead of the raw
  // buffer's would fail right there — and an in-place edit of the watched
  // result still detaches its token.
  it('a result watched through a nonaligned window still detaches old clients on an in-place edit', async () => {
    const big = user('ub', 'x'.repeat(2300 * 1024), 4)
    const res = out('r1', 'watched-result-content', 6)
    const pad = user('u3', 'pad ' + 'y'.repeat(9 * 1024), 8)
    const pre = J(psess('s1'), user('u1', 'q', 1), call(), big) + '\n'
    const resOff = Buffer.byteLength(pre)
    const resLen = Buffer.byteLength(JSON.stringify(res))
    const resEnd = resOff + resLen + 1
    const v1 = body(psess('s1'), user('u1', 'q', 1), call(), big, res, pad)
    const reads: { start: number, len: number }[] = []
    const disk = { [FILE]: { body: v1 } }
    const t = mk(disk, { reads })
    // An older page exists only under live proof — mint a token first.
    const first = await t.chat(PANE, {})
    reads.length = 0
    const page = await t.chat(PANE, { before: v1.length, since: first.token })
    expect(page.older).toBe(true)
    expect(page.items!.find(i => i.toolId === 't1')).toMatchObject({ out: 'watched-result-content' })
    // The first window's buffer began inside the big record — a positive
    // read start before the result's offset, not a full-file aligned read.
    expect(reads.some(r => r.start > 0 && r.start < resOff)).toBe(true)
    // The second client's list starts at the old file end (after the pad):
    // its anchor above and its retained check can cover the tail only.
    const extra = Buffer.from(J(user('u4', 'fresh tail', 10)) + '\n')
    disk[FILE].body = Buffer.concat([v1, extra])
    const r2 = await t.chat(PANE2, { from: v1.length })
    expect(r2.rewritten).toBeUndefined()
    // Pure growth minted nothing: still the first client's generation — a
    // wrongly-based fingerprint would already have forced a new stamp.
    expect(stampOf(r2.token)).toBe(stampOf(first.token))
    const same = await poll(t, r2.token, v1.length, PANE2)
    expect(same.unchanged).toBe(true)
    // An in-place edit of the watched record plus growth: the second
    // client's token detaches even though its own checks cannot see it.
    const res2 = Buffer.from(JSON.stringify(out('r1', 'xatched-result-content', 6)) + '\n')
    expect(res2.length).toBe(resLen + 1)
    disk[FILE] = { body: Buffer.concat([v1.subarray(0, resOff), res2, v1.subarray(resEnd), extra, Buffer.from(J(user('u5', 'later', 11)) + '\n')]), mtimeMs: 9 }
    const det = await poll(t, r2.token, v1.length, PANE2)
    expect(det.rewritten).toBe(true)
    expect(det.older).toBeUndefined()
    expect(stampOf(det.token)).not.toBe(stampOf(r2.token))
  })
})

// M5: Command Code continuity evidence is a bounded head+tail fingerprint
// of the claimed prefix (64 KiB windows, merged where they touch), never a
// whole-file digest a multi-GiB transcript could not afford.
describe('Command Code bounded fingerprint', () => {
  const K = 64 * 1024
  const BIG = 3 * 1024 * 1024 * 1024 // virtual: stat claims it, reads synthesize
  const SEC = 1767225600000 // a whole-second mtime: the settling path
  const located = { file: FILE, session: 's1' }
  const mkAt = (disk: Record<string, MemFile>, io: MemIo, now: () => number, digest?: MachineFs['digest']) =>
    createTranscripts({
      home: '/h', herdr: noHerdr,
      fs: digest ? { ...memFs(disk, io), digest } : memFs(disk, io),
      now, locateCommandCode: async () => located,
    })
  // The ranges a bounded fingerprint of a `size`-byte claim covers: head
  // and tail 64 KiB windows — one read of the whole claim when they touch
  // (≤ 128 KiB), two disjoint reads otherwise.
  const fingerWindows = (size: number): [number, number][] =>
    size <= 2 * K ? [[0, size]] : [[0, K], [size - K, K]]
  const fingerHit = (size: number, r: { start: number, len: number }) =>
    fingerWindows(size).some(([s, l]) => r.start === s && r.len === l)
  // Reads attributable to fingerprinting any of the given claims — exact
  // claimed ranges, so ordinary tail/anchor reads can't be confused with
  // validation. A shared window is counted once per actual read.
  const fingerReads = (io: MemIo, ...sizes: number[]) =>
    io.reads!.filter(r => sizes.some(s => fingerHit(s, r)))
  // A sparse file: `size` is only claimed by stat; ranges are synthesized —
  // `segs` at absolute offsets, `patch` byte edits on top, 'x' fill
  // elsewhere — so growth by new segments keeps the old prefix
  // position-stable like a real append.
  const sparse = (size: number, mtimeMs: number, ...segs: { at: number, buf: Buffer }[]) => {
    const patch = new Map<number, number>()
    const file: MemFile = { body: Buffer.alloc(0), size, mtimeMs, ino: 77 }
    const io: MemIo = {
      reads: [],
      onRead: (start, len) => {
        const b = Buffer.alloc(len, 0x78)
        for (const { at, buf } of segs) {
          const s = Math.max(start, at), e = Math.min(start + len, at + buf.length)
          if (e > s) buf.copy(b, s - start, s - at, e - at)
        }
        for (const [off, v] of patch) if (off >= start && off < start + len) b[off - start] = v
        return b
      },
    }
    return { file, io, patch, segs }
  }
  const tail = (...l: unknown[]) => body(...l)

  it('serves a virtual 3 GiB transcript through chat — the cmd preview path — bounded, never digested', async () => {
    let clock = 1_000_000
    const tailBuf = tail(psess('s1'), user('u1', 'question', 1), call(), out('r1', 'result'))
    const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
    const digest = vi.fn(async () => 'x')
    const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock, digest)
    const r1 = await t.chat(PANE, {})
    expect(r1.items!.map(i => i.role)).toEqual(['user', 'tool'])
    expect(r1.items!.find(i => i.toolId === 't1')).toMatchObject({ out: 'result' })
    expect(r1.start).toBeGreaterThan(0) // the unsettled-token gate needs from > 0
    expect(r1.token).toContain('!') // coarse whole-second state: unsettled
    // Command Code never digests — even with fs.digest on this machine —
    // and its capture fits the two 64 KiB windows whatever st.size claims.
    expect(digest).not.toHaveBeenCalled()
    const first = fingerReads(sp.io, BIG)
    expect(first.length).toBe(2)
    expect(first.reduce((n, r) => n + r.len, 0)).toBeLessThanOrEqual(2 * K)
    // The reused unsettled token re-samples exactly the claimed prefix.
    clock += 1600 // past the settling window
    sp.io.reads!.length = 0
    const r2 = await poll(t, r1.token, r1.start)
    expect(r2.rewritten).toBeUndefined()
    expect(r2.token).not.toContain('!')
    expect(digest).not.toHaveBeenCalled()
    const second = fingerReads(sp.io, BIG)
    expect(second.length).toBe(2)
    expect(second.reduce((n, r) => n + r.len, 0)).toBeLessThanOrEqual(2 * K)
    // A settled state polled with its full settled token: zero IO at all.
    sp.io.reads!.length = 0
    const same = await t.chat(PANE, { since: r2.token, from: r1.start, anchor: r2.token })
    expect(same.unchanged).toBe(true)
    expect(sp.io.reads).toEqual([])
    expect(digest).not.toHaveBeenCalled()
  })

  it('merges the head and tail windows where they touch — 64/128 KiB boundaries', async () => {
    for (const size of [K, K + 1, 2 * K, 2 * K + 1]) {
      let clock = 1_000_000
      const tailBuf = tail(psess('s1'), user('u1', 'q', 1))
      const sp = sparse(size, SEC, { at: size - tailBuf.length, buf: tailBuf })
      const digest = vi.fn(async () => 'x')
      const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock, digest)
      const r = await t.chat(PANE, {})
      expect(r.token).toContain('!')
      expect(digest).not.toHaveBeenCalled()
      // The fingerprint reads lead the request (the capture is taken before
      // the bottom is read): assert the initial ranges, not a `.some`
      // anywhere that could match ordinary body IO.
      const wins = fingerWindows(size)
      expect(sp.io.reads!.slice(0, wins.length)).toEqual(wins.map(([start, len]) => ({ start, len })))
    }
  })

  it('answers the public preview through the guarded chat on a fresh coarse 3 GiB reader', async () => {
    let clock = 1_000_000
    const tailBuf = tail(psess('s1'), user('u1', 'q', 1), assistant('a2', [{ type: 'text', text: 'All done' }], 5))
    const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
    const digest = vi.fn(async () => 'x')
    const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock, digest)
    const p = await t.preview(PANE)
    expect(p).toBe('All done')
    expect(digest).not.toHaveBeenCalled()
    const fr = fingerReads(sp.io, BIG)
    expect(fr.length).toBe(2)
    expect(fr.reduce((n, r) => n + r.len, 0)).toBeLessThanOrEqual(2 * K)
  })

  it('keeps an appended claimed prefix continuous and revalidates exactly it', async () => {
    let clock = 1_000_000
    const S0 = BIG // past the tail window: the reply starts > 0
    const tailBuf = tail(psess('s1'), user('u1', 'q', 1), call(), out('r1', 'result'))
    const sp = sparse(S0, SEC, { at: S0 - tailBuf.length, buf: tailBuf })
    const digest = vi.fn(async () => 'x')
    const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock, digest)
    const r1 = await t.chat(PANE, {})
    expect(r1.token).toContain('!')
    expect(r1.start).toBeGreaterThan(0) // positive-from continuity, per brief
    // Append only: new bytes land after the claimed end — a real append.
    const extra = Buffer.from(J(user('u2', 'more', 2)) + '\n')
    const S1 = S0 + extra.length
    sp.segs.push({ at: S0, buf: extra })
    sp.file.size = S1
    sp.file.mtimeMs = SEC + 1000
    clock += 200
    sp.io.reads!.length = 0
    const r2 = await poll(t, r1.token, r1.start)
    expect(r2.rewritten).toBeUndefined()
    expect(r2.items!.map(i => i.role)).toContain('user')
    expect(digest).not.toHaveBeenCalled()
    // One request, two fingerprints: the grown state's capture and the OLD
    // claim's validation — ≤ 4 bounded reads, ~256 KiB together.
    const frs = fingerReads(sp.io, S0, S1)
    expect(frs.length).toBeLessThanOrEqual(4)
    expect(frs.reduce((n, r) => n + r.len, 0)).toBeLessThanOrEqual(4 * K)
    // The old claim's tail window really was re-sampled — validation of the
    // OLD size, not the current total — and the grown capture's tail too.
    expect(frs.some(r => r.start === S0 - K && r.len === K)).toBe(true)
    expect(frs.some(r => r.start === S1 - K && r.len === K)).toBe(true)
    // A head-window edit outside any anchor, plus further growth: stat
    // fields, inode and anchors stay consistent with a plain append — only
    // the fingerprint can see it.
    sp.patch.set(100, 0x21)
    const more = Buffer.from(J(user('u3', 'again', 3)) + '\n')
    sp.segs.push({ at: S1, buf: more })
    sp.file.size = S1 + more.length
    sp.file.mtimeMs = SEC + 2000
    const r3 = await poll(t, r2.token, r2.start)
    expect(r3.rewritten).toBe(true)
    expect(digest).not.toHaveBeenCalled()
  })

  it('reports changed on head and tail window mutations, truncation and an inode flip', async () => {
    for (const spot of ['head', 'tail', 'truncate', 'inode'] as const) {
      let clock = 1_000_000
      const tailBuf = tail(psess('s1'), user('u1', 'q', 1))
      const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
      const digest = vi.fn(async () => 'x')
      const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock, digest)
      const r1 = await t.chat(PANE, {})
      expect(r1.token).toContain('!')
      // 'head' and 'tail' edit inside the sampled windows but outside the
      // items' anchor region — the fingerprint alone can see them.
      if (spot === 'head') sp.patch.set(100, 0x21)
      else if (spot === 'tail') sp.patch.set(BIG - 32 * 1024, 0x21)
      else if (spot === 'truncate') sp.file.size = BIG / 2
      else sp.file.ino = 78
      const r = await poll(t, r1.token, r1.start)
      expect(r.rewritten).toBe(true)
      expect(digest).not.toHaveBeenCalled()
    }
  })

  it('reports changed on failed or short samples, and a failed first sample stays conservative', async () => {
    for (const mode of ['fail', 'short', 'firstfail'] as const) {
      let clock = 1_000_000
      const tailBuf = tail(psess('s1'), user('u1', 'q', 1))
      const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
      // 'fail'/'short' arm after the first capture so the bad answer lands
      // on the reused-token validation; 'firstfail' lands on the capture.
      let armed = mode === 'firstfail'
      const failing: MemIo = {
        ...sp.io,
        onRead: (start: number, len: number) => {
          if (armed && (start === 0 || start === BIG - K)) {
            return mode === 'short' ? Buffer.alloc(len - 1, 0x78) : Promise.reject(new Error('sample io'))
          }
          return sp.io.onRead!(start, len)
        },
      }
      const t = mkAt({ [FILE]: sp.file }, failing, () => clock, vi.fn(async () => 'x'))
      const r1 = await t.chat(PANE, {})
      expect(r1.items!.length).toBeGreaterThan(0)
      armed = true
      clock += 1600
      const r = await poll(t, r1.token, r1.start)
      // Unknown evidence is never a proven match: same shape as a checksum
      // this machine could not take — the client is told to start again.
      expect(r.rewritten).toBe(true)
    }
  })

  it('detects mutations even with no fs.digest on the machine at all', async () => {
    let clock = 1_000_000
    const tailBuf = tail(psess('s1'), user('u1', 'q', 1))
    const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
    const t = mkAt({ [FILE]: sp.file }, sp.io, () => clock) // no digest
    const r1 = await t.chat(PANE, {})
    sp.patch.set(100, 0x21)
    const r = await poll(t, r1.token, r1.start)
    expect(r.rewritten).toBe(true)
  })

  it('never publishes evidence sampled across a generation replacement', async () => {
    let clock = 1_000_000
    const tailBuf = tail(psess('s1'), user('u1', 'q', 1))
    const sp = sparse(BIG, SEC, { at: BIG - tailBuf.length, buf: tailBuf })
    const gate = defer<Buffer>()
    const entered = defer()
    // A's fingerprint head read is held in flight; its bytes were captured
    // before the gate — what resolves is genuinely the old evidence.
    let armed = true
    const io: MemIo = {
      reads: [],
      onRead: (start, len) => {
        const b = sp.io.onRead!(start, len) as Buffer
        if (armed && start === 0 && len === K) {
          armed = false
          entered.resolve()
          return gate.promise.then(() => b)
        }
        return b
      },
    }
    const t = mkAt({ [FILE]: sp.file }, io, () => clock, vi.fn(async () => 'x'))
    const a = t.chat(PANE, {})
    await entered.promise
    // A replacement lands; another caller observes it and the generation
    // stamp moves — A's in-flight sample detaches before it resolves.
    sp.file.ino = 78
    sp.file.mtimeMs = SEC + 1000
    const b = await t.chat(PANE, {})
    expect(b.items!.length).toBeGreaterThan(0)
    gate.resolve()
    await expect(a).rejects.toThrow('generation changed')
  })

  it('re-attempts once when generation goes stale during current() and returns not_found when locate drifts', async () => {
    const v1 = body(psess('s1'), user('u1', 'first', 1))
    const v2 = body(psess('s1'), user('u9', 'fresh gen', 2))
    const disk: Record<string, MemFile> = { [FILE]: { body: v1, mtimeMs: 1 } }
    const locGate = defer()
    const locEntered = defer()
    let locCalls = 0
    const t = createTranscripts({
      home: '/h',
      herdr: noHerdr,
      fs: memFs(disk),
      locateCommandCode: async () => {
        locCalls++
        if (locCalls === 2) {
          // Hold post-read current() check on attempt 0 while a second caller
          // observes a new generation on the same file, making ctx.live() false.
          locEntered.resolve()
          await locGate.promise
        }
        return { file: FILE, session: 's1' }
      },
    })
    const first = t.chat(PANE, {})
    await locEntered.promise
    disk[FILE] = { body: v2, mtimeMs: 5000, ino: 2 }
    await t.chat(PANE2, {})
    locGate.resolve()
    const retried = await first
    expect(retried.available).toBe(true)
    expect(retried.items!.some(i => i.text === 'fresh gen')).toBe(true)
    expect(locCalls).toBe(6)

    // When post-read locate returns null, chat() reports not_found.
    let disappearCalls = 0
    const t2 = createTranscripts({
      home: '/h',
      herdr: noHerdr,
      fs: memFs(disk),
      locateCommandCode: async () => {
        disappearCalls++
        return disappearCalls === 1 ? { file: FILE, session: 's1' } : null
      },
    })
    await expect(t2.chat(PANE, {})).resolves.toEqual({ available: false, reason: 'not_found' })
  })
})
