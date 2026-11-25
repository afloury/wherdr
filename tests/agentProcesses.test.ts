import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AGENT_CENSUS_SCRIPT, agentCensus } from '../server/utils/agentProcesses'
import { parseAgentCensus } from '../server/utils/agentCensus'
import { shq } from '../server/utils/fsx'
import { CMD_ALIASES } from '../shared/cmdAliases'
import { localShell } from './helpers/localShell'

const linux = it.runIf(process.platform === 'linux')
const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }) })
const BORN = 1767225723464 // 500.12s uptime, tick 123.45+1s => boot*1000 + 123464ms

// Deterministic timebase: uptime 500.12, btime 1767225600, a `date` shim that
// prints the fixed wall clock -> tick 12345 yields birth bound BORN exactly.
function fakeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'procx-'))
  roots.push(root)
  fs.mkdirSync(`${root}/bin`)
  fs.writeFileSync(`${root}/bin/date`, '#!/bin/sh\necho 1767226100.123456789\n', { mode: 0o755 })
  fs.writeFileSync(`${root}/uptime`, '500.12 1234.56\n')
  fs.writeFileSync(`${root}/stat`, 'cpu  0 0 0 0\nbtime 1767225600\n')
  return root
}
const inPath = (root: string): typeof localShell =>
  (script, args, opts) => localShell(`export PATH=${shq(`${root}/bin`)}:$PATH\n${script}`, args, opts)
const run = (root: string, maxr?: string) => inPath(root)(AGENT_CENSUS_SCRIPT, maxr ? [root, '8192', maxr] : [root], { timeoutMs: 8000 })
  .then(r => parseAgentCensus(r.stdout.toString('utf8')))

// stat layout: pid (comm) state ppid <17 zeros> startticks ...  (starttime is field 22)
function fakeProc(root: string, pid: number, o: { comm?: string, state?: string, ppid?: number, ticks?: number, argv?: string[] | null, cwd?: string, exe?: string, unreadable?: boolean, noStat?: boolean, noCmdline?: boolean }) {
  const d = `${root}/${pid}`
  fs.mkdirSync(d)
  if (o.noStat) return
  fs.writeFileSync(`${d}/stat`, `${pid} (${o.comm ?? 'node'}) ${o.state ?? 'S'} ${o.ppid ?? 1} ` + '0 '.repeat(17) + `${o.ticks ?? 12345} 0 0 0 0\n`)
  if (!o.noCmdline) fs.writeFileSync(`${d}/cmdline`, o.argv == null ? '' : Buffer.from(o.argv.join('\0') + '\0'))
  fs.writeFileSync(`${d}/comm`, `${o.comm ?? 'node'}\n`)
  if (o.cwd) fs.symlinkSync(o.cwd, `${d}/cwd`)
  if (o.exe) fs.symlinkSync(o.exe, `${d}/exe`)
  if (o.unreadable) for (const f of ['stat', 'cmdline', 'comm']) fs.chmodSync(`${d}/${f}`, 0)
}

linux('census over a synthetic /proc: bin-symlink, retitled, wrapper and nested peers', async () => {
  const root = fakeRoot()
  const pkg = `${root}/pkg/command-code/dist`
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(`${pkg}/index.mjs`, '// x')
  fs.symlinkSync('../pkg/command-code/dist/index.mjs', `${root}/bin/cmd`) // bin/ already holds the date shim
  fakeProc(root, 101, { argv: ['node', `${root}/bin/cmd`, '-r', 'sess a'], cwd: '/work/acme shop', exe: '/usr/bin/node' })
  fakeProc(root, 102, { comm: 'command-code', argv: ['command-code'], cwd: '/work/other\n', exe: '/usr/bin/node' }) // retitled; trailing-newline cwd
  fakeProc(root, 103, { comm: 'sh', argv: ['sh', '-c', 'command-code'], cwd: '/work/acme shop', exe: '/bin/dash' }) // wrapper, not a peer
  fakeProc(root, 104, { ppid: 102, comm: 'command-code', argv: ['command-code'], cwd: '/work/nested', exe: '/usr/bin/node' }) // nested cmd: still a peer
  fakeProc(root, 105, { comm: 'kworker/1:0', argv: [] }) // kernel-thread shape
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.processes.map(p => p.pid).sort()).toEqual([101, 102, 104])
  const p = c.processes.find(p => p.pid === 101)!
  expect(p.argv).toEqual(['node', `${root}/bin/cmd`, '-r', 'sess a'])
  expect(p.argvExact).toBe(true)
  expect(p.cwd).toBe('/work/acme shop')
  expect(p.startedAt).toBe(BORN)
  const rt = c.processes.find(p => p.pid === 102)!
  expect(rt.argvExact).toBe(false)
  expect(rt.cwd).toBe('/work/other\n') // real trailing newline survives
})

linux('generic argv0 and comm still resolve when /proc/pid/exe names a package entrypoint', async () => {
  const root = fakeRoot()
  fakeProc(root, 151, { comm: 'wrapper', argv: ['wrapper', '--flag'], cwd: '/work/acme-shop', exe: '/opt/pkg/command-code/bin/cmdc' })
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.processes.map(p => p.pid)).toEqual([151])
})

linux('an unclassifiable live interpreter stays emitted bounded evidence', async () => {
  const root = fakeRoot()
  fakeProc(root, 201, { argv: ['node', '/x/bin/cmdc'], cwd: '/w/x', exe: '/usr/bin/node' })
  fakeProc(root, 202, { comm: 'node', argv: null, cwd: '/w/x', exe: '/usr/bin/node', unreadable: false })
  fs.chmodSync(`${root}/202/cmdline`, 0) // live node, unreadable cmdline: a possible hidden peer
  fakeProc(root, 203, { comm: 'sshd', argv: null }) // unrelated unreadable: does not disable
  fs.chmodSync(`${root}/203/cmdline`, 0)
  fakeProc(root, 204, { comm: 'command-code', argv: null, state: 'Z' }) // proven zombie: not a peer
  const c = await agentCensus(inPath(root), { procRoot: root })
  // 202's stat/generation and cwd read fine: emit it as scoped evidence
  // rather than a recordless footer unknown. Its argv stays empty — never
  // a proven other, and the lookup decides relevance by cwd.
  expect(c.complete).toBe(true)
  expect(c.unknown).toBe(0)
  expect(c.processes.map(p => p.pid)).toEqual([201])
  expect(c.uncertain.map(p => p.pid)).toEqual([202])
  expect(c.uncertain[0]).toMatchObject({ pid: 202, comm: 'node', cwd: '/w/x' })
  expect(c.uncertain[0]?.argv).toBeUndefined()
})

linux('every producer-suspicious empty-argv comm reaches uncertain, never other', async () => {
  const root = fakeRoot()
  // Actual comm=node_repl with an EMPTY cmdline — the missing file models an
  // unreadable read deterministically — plus one shape per broad producer
  // prefix family. All carry valid generation/exe/cwd metadata; a missing
  // cmdline file, an empty one and an empty comm all take the same arm.
  fakeProc(root, 401, { comm: 'node_repl', noCmdline: true, cwd: '/w/repl', exe: '/usr/bin/node' })
  fakeProc(root, 402, { comm: 'nodejs_foo', argv: null, cwd: '/w/nj', exe: '/usr/bin/node' })
  fakeProc(root, 403, { comm: 'bun-repl', noCmdline: true, cwd: '/w/bun', exe: '/usr/bin/bun' })
  fakeProc(root, 404, { comm: 'deno_task', noCmdline: true, cwd: '/w/deno', exe: '/usr/bin/deno' })
  fakeProc(root, 405, { comm: 'command-code2', noCmdline: true, cwd: '/w/cc', exe: '/usr/bin/node' })
  fakeProc(root, 406, { comm: 'command_code_x', argv: null, cwd: '/w/ccu', exe: '/usr/bin/node' })
  fakeProc(root, 407, { comm: 'commandcode-x', noCmdline: true, cwd: '/w/ccn', exe: '/usr/bin/node' })
  fakeProc(root, 408, { comm: 'cmd', argv: null, cwd: '/w/cmd', exe: '/x/cmd' })
  fakeProc(root, 409, { comm: 'cmd.exe', argv: null, cwd: '/w/cmdx', exe: '/x/cmd.exe' })
  fakeProc(root, 410, { comm: '', argv: null, cwd: '/w/nocomm', exe: '/usr/bin/node' }) // unreadable comm
  fakeProc(root, 411, { comm: 'sshd', argv: null, cwd: '/w/x' }) // proven other: never emitted
  fakeProc(root, 412, { comm: 'node', argv: null, state: 'Z', cwd: '/w/z', exe: '/usr/bin/node' }) // zombie: skipped
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.unknown).toBe(0)
  expect(c.processes).toEqual([])
  expect(c.uncertain.map(p => p.pid)).toEqual([401, 402, 403, 404, 405, 406, 407, 408, 409, 410])
  expect(c.uncertain[0]).toMatchObject({ pid: 401, comm: 'node_repl', cwd: '/w/repl', exe: '/usr/bin/node' })
})

linux('unreadable or vanished potential peers keep the census honest', async () => {
  const root = fakeRoot()
  fakeProc(root, 301, { argv: ['node', '/x/bin/cmdc'], cwd: '/w/x', exe: '/usr/bin/node' })
  fakeProc(root, 302, { comm: 'command-code', argv: ['command-code'], cwd: '/w/y', exe: '/usr/bin/node', unreadable: true })
  fakeProc(root, 303, { noStat: true }) // vanished before sampling
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.incomplete).toBe('metadata')
  expect(c.unknown).toBe(1)
  expect(c.processes.map(p => p.pid)).toEqual([301])
})

linux('relative entrypoint resolves through the process cwd link', async () => {
  const root = fakeRoot()
  const pkg = `${root}/pkg/command-code/dist`
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(`${pkg}/index.mjs`, '// x')
  fakeProc(root, 401, { argv: ['node', 'index.mjs'], cwd: pkg, exe: '/usr/bin/node' })
  fakeProc(root, 402, { argv: ['node', 'index.mjs'], cwd: '/srv/plain-app', exe: '/usr/bin/node' })
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.processes.map(p => p.pid)).toEqual([401])
})

linux('producer finds the entrypoint behind node options; plain interpreters are other', async () => {
  const root = fakeRoot()
  const pkg = `${root}/pkg/command-code/dist`
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(`${pkg}/index.mjs`, '// x')
  fakeProc(root, 601, { argv: ['node', '-r', 'a', '-r', 'b', '-r', 'c', '-r', 'd', `${pkg}/index.mjs`], cwd: '/w/x', exe: '/usr/bin/node' })
  fakeProc(root, 602, { argv: ['node', '/srv/server.js', 'cmd'], cwd: '/w/x', exe: '/usr/bin/node' }) // arg, not identity
  fakeProc(root, 603, { argv: ['node', '--mystery', 'x.js'], cwd: '/w/x', exe: '/usr/bin/node' }) // unknown launch shape
  fakeProc(root, 604, { argv: ['node', '-e', `require('${pkg}/index.mjs')`], cwd: '/w/x', exe: '/usr/bin/node' }) // eval: not a launch
  fakeProc(root, 605, { argv: ['node', '--conditions', 'command-code', '/srv/server.js'], cwd: '/w/x', exe: '/usr/bin/node' }) // value operand: not identity
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.processes.map(p => p.pid)).toEqual([601])
  // A readable cmdline without Command Code evidence is a proven other — even
  // an unlisted option shape or eval code — never uncertain evidence.
  expect(c.uncertain).toEqual([])
})

linux('producer stdout is capped before the exec reply', async () => {
  const root = fakeRoot()
  const big = 'y'.repeat(16000) // ~22 KiB base64 per record
  for (let i = 0; i < 170; i++) fakeProc(root, 1000 + i, { argv: ['node', '/x/bin/cmdc', big], cwd: '/w/x', exe: '/usr/bin/node' })
  const r = await inPath(root)(AGENT_CENSUS_SCRIPT, [root], { timeoutMs: 30000 })
  expect(r.stdout.length).toBeLessThanOrEqual(3_200_000)
  expect(parseAgentCensus(r.stdout.toString('utf8')).incomplete).toBe('oversize')
}, 30000)

linux('pass 1 skips plain interpreters with no Command Code evidence', async () => {
  const root = fakeRoot()
  // The review's reproduction: idle node processes in a project cost a full
  // record each (about 55 ms). Pass 1 must drop them without any per-process
  // fork — an absolute script that neither names nor resolves to the package
  // proves nothing. `bun run dev` in the same project is a proven other, not
  // uncertain evidence; only an unreadable cmdline stays uncertain.
  for (let i = 0; i < 12; i++) {
    fakeProc(root, 700 + i, { argv: ['node', `/srv/app${i}.js`, '--port', String(8000 + i)], cwd: '/srv/project', exe: '/usr/bin/node' })
  }
  fakeProc(root, 720, { comm: 'bun', argv: ['bun', 'run', '/srv/build.ts'], cwd: '/srv/project', exe: '/usr/bin/bun' })
  fakeProc(root, 721, { comm: 'deno', argv: ['deno', 'run', '--allow-net', 'https://host/app.ts'], cwd: '/srv/project', exe: '/usr/bin/deno' })
  fakeProc(root, 722, { comm: 'node', argv: null, cwd: '/srv/project', exe: '/usr/bin/node' })
  fs.chmodSync(`${root}/722/cmdline`, 0) // live, unreadable cmdline: a possible hidden peer
  const r = await inPath(root)(AGENT_CENSUS_SCRIPT, [root], { timeoutMs: 8000 })
  const out = r.stdout.toString('utf8')
  // Not one plain interpreter reached a full record: only the live process
  // with an unreadable cmdline is still collected, as scoped evidence.
  expect(out.match(/^S /gm)).toEqual(['S '])
  const c = parseAgentCensus(out)
  expect(c.complete).toBe(true)
  expect(c.scanned).toBe(15) // every live pid was still counted
  expect(c.processes).toEqual([])
  expect(c.uncertain.map(p => p.pid)).toEqual([722])
})

linux('pass 1 keeps an interpreter whose arguments could name the package', async () => {
  const root = fakeRoot()
  const pkg = `${root}/pkg/command-code/dist`
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(`${pkg}/index.mjs`, '// x')
  // Each shape is kept for pass 2 to classify: an evidence word, a package
  // path and a bare relative operand (which may resolve through the cwd).
  fakeProc(root, 801, { argv: ['node', '/srv/server.js', 'cmdc'], cwd: '/srv/project', exe: '/usr/bin/node' })
  fakeProc(root, 802, { argv: ['node', '/srv/server.js', `${pkg}/index.mjs`], cwd: '/srv/project', exe: '/usr/bin/node' })
  fakeProc(root, 803, { argv: ['node', 'index.mjs'], cwd: pkg, exe: '/usr/bin/node' })
  fakeProc(root, 804, { argv: ['bun', 'run', 'dev'], cwd: '/srv/project', exe: '/usr/bin/bun' })
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.scanned).toBe(4)
  expect(c.processes.map(p => p.pid)).toEqual([803]) // only the real launch
  expect(c.uncertain).toEqual([])
})

linux('the census script recognizes exactly the names CMD_ALIASES declares', async () => {
  // The shell's candidate rule and the shared alias list must never drift: an
  // alias added to CMD_ALIASES without the script (or the reverse) would make
  // a real agent invisible to the census, or a name prove Command Code that
  // is not. Each declared alias is launched as a bare process; a renamed
  // lookalike is not one.
  const root = fakeRoot()
  for (const [i, name] of CMD_ALIASES.entries()) {
    fakeProc(root, 900 + i, { comm: name, argv: [name], cwd: '/w/x', exe: '/usr/bin/node' })
  }
  fakeProc(root, 990, { comm: 'command-code2', argv: ['command-code2'], cwd: '/w/x', exe: '/usr/bin/node' })
  fakeProc(root, 991, { comm: 'cmdcx', argv: ['cmdcx'], cwd: '/w/x', exe: '/usr/bin/node' })
  const c = await agentCensus(inPath(root), { procRoot: root })
  expect(c.complete).toBe(true)
  expect(c.processes.map(p => p.pid).sort()).toEqual(CMD_ALIASES.map((_, i) => 900 + i))
  // Nothing from the script's candidate family is missing from CMD_ALIASES:
  // every bare name it selects is one the shared list already declares.
  for (const p of c.processes) expect(CMD_ALIASES).toContain(p.comm)
})

linux('record cap, missing proc and missing uptime never yield a usable sole peer', async () => {
  const root = fakeRoot()
  fakeProc(root, 501, { argv: ['node', '/x/bin/cmdc'], cwd: '/w/x', exe: '/usr/bin/node' })
  fakeProc(root, 502, { argv: ['node', '/x/bin/cmdc'], cwd: '/w/y', exe: '/usr/bin/node' })
  expect((await agentCensus(inPath(root), { procRoot: root })).complete).toBe(true)
  expect((await run(root, '1')).incomplete).toBe('oversize')
  expect((await agentCensus(inPath(root), { procRoot: `${root}/gone` })).incomplete).toBe('unavailable')
  fs.rmSync(`${root}/uptime`)
  expect((await agentCensus(inPath(root), { procRoot: root })).incomplete).toBe('unavailable')
})
