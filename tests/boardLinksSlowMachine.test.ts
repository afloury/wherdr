// The board's links of a remote machine whose SSH reads are slow (each one
// waits behind the other reads of a page that was just reloaded): the home
// list must get its board grouping without waiting for a full read again.
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FsError, type MachineFs } from '../server/utils/fsx'
import type { Machine } from '../server/utils/machines'

const deps = vi.hoisted(() => ({ machines: [] as unknown[] }))
vi.mock('../server/utils/machines', () => ({ baseMachines: () => deps.machines, allMachines: () => deps.machines }))
vi.mock('../server/utils/projectsTasks', () => ({ sessionMachine: (m: Machine) => m.key }))

import { readBoardLinks, resetBoardLinks } from '../server/utils/boardLinks'

// One SSH command, queued behind the page's other reads.
const CALL_MS = 6000
const HOME = '/home/u'
const DATA = `${HOME}/.herdr-projects/data`
const REPOS = ['shop', 'blog', 'docs', 'api']
let files: Record<string, string>
let down = false

const slow = async <T>(f: () => T, listing = false): Promise<T> => {
  await new Promise(r => setTimeout(r, CALL_MS))
  // A folder listing that times out in the queue (the other reads get through).
  if (down && listing) throw new FsError('unreachable', 'timeout')
  return f()
}
const children = (dir: string) => {
  // `cd` into a file, as the shell fs reports it.
  if (dir in files) throw new FsError('remote', `not a directory: ${dir}`)
  const pre = `${dir}/`
  const out = new Set(Object.keys(files).filter(p => p.startsWith(pre)).map(p => p.slice(pre.length).split('/')[0]!))
  if (!out.size) throw new FsError('ENOENT', `no such file: ${dir}`)
  return [...out]
}
const fs = {
  readdir: p => slow(() => children(p), true),
  statMany: ps => slow(() => ps.map(p => (p in files ? { isFile: true, isDir: false, size: files[p]!.length, mtimeMs: 1 } : null))),
  readFile: p => slow(() => { if (!(p in files)) throw new FsError('ENOENT', 'no such file'); return files[p]! }),
} as MachineFs
const remote = {
  key: 'abcd1234', local: false, status: 'online', home: HOME, session: 'default', fs,
  exec: () => slow(() => ({ code: 0, stdout: Buffer.from('main\t0\n'), stderr: '' })),
  info: () => ({ baseKey: 'abcd1234' }),
} as unknown as Machine

// The time (simulated) a read of the links takes.
async function timed(stale = true) {
  const start = Date.now()
  let done = false
  const p = readBoardLinks(undefined, { stale }).finally(() => { done = true })
  while (!done) await vi.advanceTimersByTimeAsync(100)
  return { ms: Date.now() - start, links: await p }
}
const coordinators = (r: Awaited<ReturnType<typeof readBoardLinks>>) =>
  'machines' in r ? r.machines.flatMap(m => m.coordinators.map(c => c.repo)) : []

beforeEach(() => {
  vi.useFakeTimers()
  resetBoardLinks()
  down = false
  deps.machines = [remote]
  files = { [`${DATA}/repos.json`]: JSON.stringify(Object.fromEntries(REPOS.map(r => [r, `/src/${r}`]))) }
  for (const r of REPOS) {
    files[`${DATA}/tasks/${r}/1/task.json`] = JSON.stringify({ id: `${r}/1`, link: { pane: 'w2:p1' } })
    files[`${DATA}/coordinator/default/projects/${r}/state.json`] = JSON.stringify({ pane: `w${r.length}:p2` })
  }
})
afterEach(() => { vi.useRealTimers() })

it('a reload after the reuse window gets the last board at once, read again behind it', async () => {
  const first = await timed()
  expect(coordinators(first.links)).toEqual(REPOS)
  // The page is reloaded a while later: the machine's files are read again.
  await vi.advanceTimersByTimeAsync(20000)
  files[`${DATA}/coordinator/default/projects/new/state.json`] = JSON.stringify({ pane: 'w9:p2' })
  const reload = await timed()
  expect(reload.ms).toBeLessThan(1000)
  expect(coordinators(reload.links)).toEqual(REPOS)
  // The read behind it ends: the next poll has the new project.
  await vi.advanceTimersByTimeAsync(60000)
  expect(coordinators((await timed()).links)).toContain('new')
})

it('a first read lists the repos\' and sessions\' folders side by side', async () => {
  const { ms } = await timed()
  // tasks/ and coordinator/, their folders, the stat, the files, git: 5 rounds.
  expect(ms).toBeLessThanOrEqual(5 * CALL_MS + 1000)
})

it('a folder listing that times out keeps the last board', async () => {
  await timed()
  down = true
  await vi.advanceTimersByTimeAsync(20000)
  await timed()
  await vi.advanceTimersByTimeAsync(60000)
  expect(coordinators((await timed()).links)).toEqual(REPOS)
})

it('notifications wait for the fresh read: a task created since is found', async () => {
  await timed()
  await vi.advanceTimersByTimeAsync(3600_000)
  files[`${DATA}/tasks/shop/2/task.json`] = JSON.stringify({ id: 'shop/2', link: { pane: 'w3:p1' } })
  const { links } = await timed(false)
  const tasks = 'machines' in links ? links.machines.flatMap(m => m.tasks.map(t => t.id)) : []
  expect(tasks).toContain('shop/2')
})

it('a stray file among the board\'s folders lists nothing and leaves the rest', async () => {
  files[`${DATA}/tasks/notes.txt`] = 'x'
  files[`${DATA}/coordinator/readme`] = 'x'
  expect(coordinators((await timed()).links)).toEqual(REPOS)
})
