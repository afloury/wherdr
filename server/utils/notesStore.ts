// Notes on the server (DATA_DIR/notes): one <id>.md per note, the files they
// link to in folders (plans/x.md), and .log.jsonl, every change with who made
// it. `wherdr alfred notes …` and `wherdr pm notes …` run here: Alfred writes
// every scope, a coordinator only those its project shows in (shared/notes.ts).
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MAX_FILE, filePath, noteBody, noteId, noteLinks, noteTabs, noteText, readNote, resolveScope, scopeName, slug, writableScopes, type Note, type NoteScope, type NotesCommand } from '../../shared/notes'
import { groupedBarItems, readBarList, readMachineGroups } from '../../app/utils/machineBar'
import { readProjectTabs } from '../../shared/settings'
import type { Project } from '../../shared/pm/project'
import type { MachineInfo } from '../../shared/types'
import { DATA_DIR } from './env'
import { HerdrError } from './herdr'
import { readSettings } from './settings'

// One change at a time per notes folder: two agents writing at once never
// lose one of their changes.
const queues = new Map<string, Promise<unknown>>()
function serial<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const next = (queues.get(dir) ?? Promise.resolve()).then(run, run)
  queues.set(dir, next.catch(() => {}))
  return next
}

type Check = (note: Note) => void | Promise<void>

export function notesStore(folder = path.join(DATA_DIR, 'notes')) {
  const dir = path.resolve(folder)
  const at = (rel: string) => {
    const full = path.resolve(dir, rel)
    if (!full.startsWith(dir + path.sep)) throw new HerdrError('bad_input', 'Outside the notes folder')
    return full
  }
  // A whole file at once, through a temporary file of its own. fresh: only
  // when the file does not exist yet (false when it does).
  const write = async (rel: string, text: string, fresh = false) => {
    const full = at(rel), tmp = `${full}.${randomUUID()}.tmp`
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(tmp, text)
    if (!fresh) return fs.rename(tmp, full).then(() => true)
    try { await fs.link(tmp, full); return true }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false; throw e }
    finally { await fs.rm(tmp, { force: true }) }
  }
  const exists = (rel: string) => fs.access(at(rel)).then(() => true, () => false)
  const log = async (by: string, action: string, what: string) => {
    await fs.mkdir(dir, { recursive: true })
    await fs.appendFile(path.join(dir, '.log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), by, action, what })}\n`)
  }
  const store = {
    dir,
    async list(): Promise<Note[]> {
      const names = await fs.readdir(dir).catch(() => [] as string[])
      const notes = await Promise.all(names.filter(n => n.endsWith('.md') && noteId(n.slice(0, -3))).map(n => store.get(n.slice(0, -3))))
      return notes.filter((n): n is Note => !!n).sort((a, b) => b.updated.localeCompare(a.updated))
    },
    async get(id: string): Promise<Note | null> {
      if (!noteId(id)) return null
      return readNote(id, await fs.readFile(at(`${id}.md`), 'utf8').catch(() => ''))
    },
    // The linked files, as paths from the folder.
    async files(): Promise<string[]> {
      const all = await fs.readdir(dir, { recursive: true }).catch(() => [] as string[])
      return all.map(f => f.split(path.sep).join('/')).filter(filePath).sort()
    },
    async readFile(rel: string): Promise<string | null> {
      return filePath(rel) ? fs.readFile(at(rel), 'utf8').catch(() => null) : null
    },
    add: (n: { title: string, scope: NoteScope, body: string }, by: string) => serial(dir, async (): Promise<Note> => {
      const now = new Date().toISOString()
      // The first free id, taken at once (never another note's file).
      for (let i = 1; ; i++) {
        const note = { id: i === 1 ? slug(n.title) : `${slug(n.title).slice(0, 44)}-${i}`, ...n, created: now, updated: now }
        if (!(await write(`${note.id}.md`, noteText(note), true))) continue
        await log(by, 'add', note.id)
        return note
      }
    }),
    // check: the writer's right, run in the queue, right before the change.
    edit: (id: string, change: Partial<Pick<Note, 'title' | 'scope' | 'body'>>, by: string, check?: Check) => serial(dir, async (): Promise<Note> => {
      const old = await store.get(id)
      if (!old) throw new HerdrError('not_found', `No note ${id}`)
      await check?.(old)
      const note = { ...old, ...change, updated: new Date().toISOString() }
      await write(`${id}.md`, noteText(note))
      await log(by, 'edit', id)
      return note
    }),
    remove: (id: string, by: string, check?: Check) => serial(dir, async () => {
      const old = await store.get(id)
      if (!old) throw new HerdrError('not_found', `No note ${id}`)
      await check?.(old)
      await fs.rm(at(`${id}.md`))
      await log(by, 'remove', id)
    }),
    putFile: (rel: string, text: string, by: string, check?: () => Promise<void>) => serial(dir, async () => {
      if (!filePath(rel)) throw new HerdrError('bad_input', `${rel}: not a notes file path`)
      await check?.()
      await write(rel, text)
      await log(by, 'file put', rel)
    }),
    removeFile: (rel: string, by: string, check?: () => Promise<void>) => serial(dir, async () => {
      if (!filePath(rel) || !(await exists(rel))) throw new HerdrError('not_found', `No file ${rel}`)
      await check?.()
      await fs.rm(at(rel))
      await log(by, 'file remove', rel)
    }),
  }
  return store
}
export type NotesStore = ReturnType<typeof notesStore>

// Who runs the command: Alfred (every scope), or a project's coordinator.
export interface NotesWriter { by: string, project?: Pick<Project, 'key' | 'machine' | 'machines' | 'paused'> }

// machines: Herdr's machines, for the machines shown as their own home tab
// (the bar's items the user has not taken off it).
export async function runNotes(store: NotesStore, cmd: NotesCommand, input: unknown, who: NotesWriter, settingsFile?: string, machines: readonly MachineInfo[] = []) {
  const s = await readSettings(settingsFile)
  const groups = readMachineGroups(s.machineGroups ?? null)
  const bases = [...new Set(machines.map(m => m.baseKey ?? m.key))]
  const label = (key: string) => machines.find(m => m.key === key)?.label || key || 'this machine'
  const hidden = readBarList(s.machineBarHidden)
  const tabs = noteTabs(groupedBarItems(readBarList(s.machineBarOrder), bases, groups).filter(id => !hidden.includes(id)), groups, label)
  const name = (scope: string) => scopeName(scope, tabs, label)
  const mine = who.project ? writableScopes(who.project, readProjectTabs(s.projectTabs)[who.project.key], groups, tabs) : ['all', ...tabs.map(t => t.scope)]
  const scopeOf = (raw: string) => {
    const r = resolveScope(raw, tabs)
    if (typeof r !== 'string') throw new HerdrError('bad_input', r.error)
    if (!mine.includes(r)) throw new HerdrError('refused', `Your project shows in ${mine.map(name).join(', ') || 'no home tab'} only: you write notes there`)
    return r
  }
  // A coordinator's default: its only scope, else it names one.
  const defaultScope = () => {
    if (!who.project || mine.length === 1) return mine[0] ?? scopeOf('all')
    throw new HerdrError('bad_input', `Name the scope: --scope ${mine.map(name).join('|')}`)
  }
  const shown = (n: Note) => ({ ...n, scope: name(n.scope) })
  const lines = async () => {
    const body = noteBody(input)
    if (typeof body !== 'string') throw new HerdrError('bad_input', body.error)
    const links = noteLinks(body)
    if (!Array.isArray(links)) throw new HerdrError('bad_input', links.error)
    const missing = (await Promise.all(links.map(async l => (await store.readFile(l)) === null && !(await store.get(l.slice(0, -3))) ? l : ''))).filter(Boolean)
    return { body, missing }
  }
  const mayWrite = (n: Note) => { if (!mine.includes(n.scope)) throw new HerdrError('not_found', `No note ${n.id} you may write (see notes list)`) }
  const writable = async (id: string) => {
    const n = await store.get(id)
    if (!n) throw new HerdrError('not_found', `No note ${id} you may write (see notes list)`)
    mayWrite(n)
    return n
  }
  // A linked file belongs to the notes that link to it: a coordinator changes
  // it only when none of them is outside its scopes.
  const fileWritable = (rel: string) => async () => {
    if (!who.project) return
    const theirs = (await store.list()).filter(n => !mine.includes(n.scope) && [noteLinks(n.body)].flat().includes(rel))
    if (theirs.length) throw new HerdrError('refused', `${rel} is linked from notes outside your scopes (${theirs.map(n => n.id).join(', ')}): you may not change it`)
  }
  const warn = (missing: string[]) => (missing.length ? { missing, note: 'These links lead nowhere yet: write them with notes file put' } : {})

  switch (cmd.verb) {
    case 'list': {
      const only = cmd.scope ? scopeOf(cmd.scope) : undefined
      return { notes: (await store.list()).filter(n => (only ? n.scope === only : mine.includes(n.scope))).map(({ body: _, ...n }) => ({ ...n, scope: name(n.scope) })), files: await store.files() }
    }
    case 'show': {
      if (cmd.id.includes('/')) {
        const text = await store.readFile(cmd.id)
        if (text === null) throw new HerdrError('not_found', `No file ${cmd.id}`)
        return { path: cmd.id, text }
      }
      return { note: shown(await writable(cmd.id)) }
    }
    case 'add': {
      const scope = cmd.scope ? scopeOf(cmd.scope) : defaultScope()
      const { body, missing } = await lines()
      return { added: shown(await store.add({ title: cmd.title, scope, body }, who.by)), ...warn(missing) }
    }
    case 'edit': {
      await writable(cmd.id)
      const given = String(input ?? '').trim() ? await lines() : undefined
      const change = { ...(cmd.title ? { title: cmd.title } : {}), ...(cmd.scope ? { scope: scopeOf(cmd.scope) } : {}), ...(given ? { body: given.body } : {}) }
      if (!Object.keys(change).length) throw new HerdrError('bad_input', 'Nothing to change: give --title, --scope or new lines on stdin')
      return { edited: shown(await store.edit(cmd.id, change, who.by, mayWrite)), ...warn(given?.missing ?? []) }
    }
    case 'remove': await store.remove(cmd.id, who.by, mayWrite); return { removed: cmd.id }
    case 'file put': {
      const text = String(input ?? '')
      if (!text.trim()) throw new HerdrError('bad_input', 'No text: give the file on stdin')
      if (text.length > MAX_FILE) throw new HerdrError('bad_input', `Over ${MAX_FILE} characters`)
      await store.putFile(cmd.path, text, who.by, fileWritable(cmd.path))
      return { put: cmd.path, link: `[label](${cmd.path})` }
    }
    case 'file remove': await store.removeFile(cmd.path, who.by, fileWritable(cmd.path)); return { removed: cmd.path }
  }
}
