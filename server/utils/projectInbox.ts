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
  const files = wanted.flatMap((id, i) => {
    const st = stats[i]
    return st && st.isFile && st.size > 0 ? [{ id, len: Math.min(st.size, ITEM_BYTES) }] : []
  })
  for (let i = 0; i < files.length; i += READS_AT_ONCE) {
    const read = await Promise.all(files.slice(i, i + READS_AT_ONCE).map(async ({ id, len }) => {
      const text = await t.m.fs.read(`${dir}/${id}.md`, 0, len).then(b => b.toString('utf8')).catch(() => '')
      const item = parseInboxItem(text.length >= ITEM_BYTES && !text.includes('\n+++\n') ? '' : text)
      // The file name is the ID `inbox done` takes: an item saying otherwise is not shown.
      return item && item.id === id ? item : null
    }))
    for (const item of read) if (item) items.push(item)
  }
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
