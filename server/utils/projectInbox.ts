// Inbox and Routines tabs of the Project panel, on the coordinator's machine.
// herdr-projects 0.2.34 lists neither as JSON (shared/projectInbox.ts): the
// inbox is read from the project's `inbox/*.md` files, routines from the
// tab-separated output of `routine list`. The only change made is `inbox done`,
// as a herdr-projects command. Routines are read-only.
import type { Pane } from '../../shared/types'
import { type InboxItem, type RoutineList, inboxDoneArgs, inboxIdOk, parseInboxItem, parseRoutineList, routineListArgs, sortInbox } from '../../shared/projectInbox'
import { lastLine } from '../../shared/projectThreads'
import { HerdrError } from './herdr'
import { stripAnsi } from './pluginPolicy'
import { type Target, projectsRoot, runProjectCommand, target } from './projectBoard'

// Items shown at most, and bytes read per item (front matter and the start of
// a routine's prompt).
export const INBOX_MAX = 100
const ITEM_BYTES = 8 * 1024
const READS_AT_ONCE = 8

// Items already read, by file (`<machine>|<path>`), kept while the file's size
// and date do not change: an inbox is re-read on every change of the project,
// and on another machine each file read is a command over SSH. A file is
// written once by herdr-projects (atomically), then only moved.
const seen = new Map<string, { size: number, mtimeMs: number, item: InboxItem | null }>()
const SEEN_MAX = 2000

type Where = Pick<Target, 'm' | 'bin' | 'dir' | 'slug'>
export interface InboxReply { items: InboxItem[], total: number }

// Unhandled items: the `.md` files directly in `inbox/` (handled ones are in
// `inbox/done/`), oldest first.
export async function inboxOn(t: Pick<Target, 'm' | 'dir'>): Promise<InboxReply> {
  const dir = `${t.dir}/inbox`
  const names = await t.m.fs.readdir(dir).catch(() => [] as string[])
  const ids = names.filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).filter(inboxIdOk).sort()
  const items: InboxItem[] = []
  const wanted = ids.slice(0, INBOX_MAX)
  // Only regular files are opened, and never more than their size: a named
  // pipe (or any special file) called `<id>.md` would block the read for good,
  // and four of them every file read of the server (Node's worker threads).
  const stats = await t.m.fs.statMany(wanted.map(id => `${dir}/${id}.md`))
  const base = `${t.m.key ?? ''}|${dir}/`
  const todo: { id: string, size: number, mtimeMs: number }[] = []
  const found = new Map<string, InboxItem>()
  wanted.forEach((id, i) => {
    const st = stats[i]
    if (!st || !st.isFile || st.size <= 0) return
    const known = seen.get(base + id)
    if (known && known.size === st.size && known.mtimeMs === st.mtimeMs) { if (known.item) found.set(id, known.item) }
    else todo.push({ id, size: st.size, mtimeMs: st.mtimeMs })
  })
  for (let i = 0; i < todo.length; i += READS_AT_ONCE) {
    await Promise.all(todo.slice(i, i + READS_AT_ONCE).map(async ({ id, size, mtimeMs }) => {
      const text = await t.m.fs.read(`${dir}/${id}.md`, 0, Math.min(size, ITEM_BYTES)).then(b => b.toString('utf8')).catch(() => null)
      // A failed read is tried again next time; anything read is remembered.
      if (text === null) return
      const parsed = parseInboxItem(text.length >= ITEM_BYTES && !text.includes('\n+++\n') ? '' : text)
      // The file name is the ID `inbox done` takes: an item saying otherwise is not shown.
      const item = parsed && parsed.id === id ? parsed : null
      seen.set(base + id, { size, mtimeMs, item })
      if (item) found.set(id, item)
    }))
  }
  for (const item of found.values()) items.push(item)
  // Handled items leave the folder: their entries go, and the map stays bounded.
  const here = new Set(ids)
  for (const key of seen.keys()) if (key.startsWith(base) && !here.has(key.slice(base.length))) seen.delete(key)
  while (seen.size > SEEN_MAX) seen.delete(seen.keys().next().value!)
  // Files that are not items do not count; the ones left unread do.
  return { items: sortInbox(items), total: items.length + (ids.length - wanted.length) }
}

// `inbox done <slug> <id>`. herdr-projects exits 0 when the item is already
// gone (handled elsewhere): the outcome is the same, the item is off the list.
export async function inboxDoneOn(t: Where, id: unknown): Promise<{ ok: true }> {
  let args: string[]
  try { args = inboxDoneArgs(projectsRoot(t), t.slug, [id as string]) }
  catch (e) { throw new HerdrError('bad_item', (e as Error).message) }
  const r = await runProjectCommand(t, args, 15000)
  if (r.code !== 0) throw new HerdrError('inbox_failed', lastLine(stripAnsi(r.stderr || r.stdout)) || `code ${r.code}`)
  return { ok: true }
}

export async function routinesOn(t: Where): Promise<RoutineList> {
  let args: string[]
  try { args = routineListArgs(projectsRoot(t), t.slug) }
  catch (e) { throw new HerdrError('bad_project', (e as Error).message) }
  const r = await runProjectCommand(t, args, 15000)
  if (r.code !== 0) throw new HerdrError('routines_failed', lastLine(stripAnsi(r.stderr || r.stdout)) || `code ${r.code}`)
  return parseRoutineList(stripAnsi(r.stdout))
}

async function need(pane: Pane): Promise<Target> {
  const t = await target(pane)
  if (!t) throw new HerdrError('no_project', 'project not found')
  return t
}
export const readInbox = async (pane: Pane) => inboxOn(await need(pane))
export const markInboxDone = async (pane: Pane, id: unknown) => inboxDoneOn(await need(pane), id)
export const readRoutines = async (pane: Pane) => routinesOn(await need(pane))
