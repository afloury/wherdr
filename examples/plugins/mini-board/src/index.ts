// mini-board (experimental): a tiny herdr-projects as a wherdr plugin (docs/plugins.md).
// Per project folder, a task list kept in .wherdr/tasks.json and a coordinator agent
// (a real Claude Code in herdr-core) that hands the tasks to worker agents.
// This file is only the Board's interface: the work is the coordinator's (coordinator.md).
import TEMPLATE from './coordinator.md'
import { renderCoordinator } from './coordinator'
import { STATUSES, addTask, parseTasks, serializeTasks, tasksPath, type Task, type TaskFile } from './tasks'

interface Agent { id: string, name: string | null, agent: string | null, status: string | null, labels: Record<string, string>, folder: string | null, machine: string }
interface Wherdr {
  onNavigate: (cb: (path: string) => void) => () => void
  agents: { start: (o: { machine?: string, folder: string, agent: string, name?: string, firstMessage?: string, labels?: Record<string, string> }) => Promise<{ id: string }>, open: (id: string) => void }
  state: { subscribe: (cb: (agents: Agent[]) => void) => () => void }
  files: { read: (machine: string, path: string) => Promise<string | null>, write: (machine: string, path: string, text: string) => Promise<void> }
}
interface Project { machine: string, folder: string }

const STYLE_ID = 'mini-board-style'
const HOME = '[data-wherdr="home-list"]'
const FOLDERS_KEY = 'wherdr:mini-board:folders'
const POLL_MS = 4000
const WORKTREES = '/.wherdr/worktrees/'
const SVG = (d: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true">${d}</svg>`
const ICON_BACK = SVG('<path d="m15 18-6-6 6-6"/>')
const ICON_BOARD = SVG('<rect x="3" y="3" width="18" height="18"/><path d="M8 7v7M12 7v4M16 7v9"/>')

const CSS = `
.mb-entry{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:0 16px;border:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:transparent;color:var(--text);font:600 12px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;cursor:pointer;text-align:left}
.mb-entry:hover,.mb-entry:focus-visible{background:var(--surface-2)}
.mb-entry small{margin-left:auto;color:var(--dim);font-weight:400;letter-spacing:0;text-transform:none;font-family:var(--sans);font-size:12px}
.mb-panel{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;background:var(--bg);color:var(--text);font:14px/1.45 var(--sans)}
.mb-head{display:flex;align-items:center;gap:4px;height:44px;padding:0 4px;margin-top:var(--safe-top,0px);border-bottom:1px solid var(--line);flex:none}
.mb-head h2{margin:0;font:700 17px/1 var(--display);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.mb-exp{margin-left:auto;padding:0 12px;color:var(--dim);font:10px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase;flex:none}
.mb-icon{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;background:transparent;color:var(--text);cursor:pointer}
.mb-icon:hover,.mb-icon:focus-visible{background:var(--surface-2)}
.mb-body{flex:1;overflow:auto;padding:0 0 calc(24px + var(--safe-bottom,0px))}
.mb-inner{max-width:760px;margin:0 auto;padding:0 16px}
.mb-label{margin:20px 0 8px;color:var(--dim);font:600 11px/1 var(--mono);letter-spacing:.08em;text-transform:uppercase}
.mb-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.mb-row{display:flex;align-items:flex-start;gap:10px;width:100%;min-height:44px;padding:10px 0;border:0;border-bottom:1px solid var(--line);background:transparent;color:inherit;font:inherit;text-align:left}
button.mb-row{cursor:pointer}button.mb-row:hover,button.mb-row:focus-visible{background:var(--surface-2)}
button.mb-row:disabled{cursor:default;background:transparent}
.mb-row-main{flex:1;min-width:0}
.mb-title{display:block;color:var(--text);font-weight:600;overflow-wrap:anywhere}
.mb-sub{display:block;color:var(--dim);font:12px/1.4 var(--mono);overflow-wrap:anywhere}
.mb-path{margin:12px 0 0}
.mb-notes{display:block;color:var(--text-2);font-size:13px;margin-top:2px;overflow-wrap:anywhere}
.mb-state{display:inline-flex;align-items:center;gap:6px;flex:none;color:var(--muted);font:11px/1 var(--mono);letter-spacing:.04em;text-transform:uppercase;padding-top:4px}
.mb-state i{width:7px;height:7px;flex:none;background:var(--dim)}
.mb-state.todo i,.mb-state.idle i{background:transparent;box-shadow:inset 0 0 0 1.5px var(--muted)}
.mb-state.idle i{box-shadow:inset 0 0 0 1.5px var(--idle)}
.mb-state.working i{background:var(--working);animation:pulse 1.3s ease-in-out infinite}
.mb-state.blocked i,.mb-state.review i{background:var(--blocked)}
.mb-state.blocked i{animation:pulse .9s ease-in-out infinite}
.mb-state.done i{background:var(--done)}
.mb-state.failed i{background:var(--danger)}
.mb-live{margin-top:6px}
.mb-coord{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}
.mb-coord p{margin:0;flex:1;min-width:180px;color:var(--text-2)}
.mb-btn{min-height:44px;padding:0 14px;border:1px solid var(--line-strong,var(--line));border-radius:0;background:transparent;color:var(--text);font:600 12px/1 var(--mono);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.mb-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
.mb-btn:disabled{opacity:.5;cursor:default}
.mb-form{display:flex;flex-direction:column;gap:8px}
.mb-form input,.mb-form textarea{width:100%;box-sizing:border-box;min-height:44px;padding:10px 12px;border:1px solid var(--input-line,var(--line));border-radius:0;background:var(--surface);color:var(--text);font:16px/1.4 var(--sans)}
.mb-form textarea{min-height:72px;resize:vertical}
.mb-form .mb-btn{align-self:flex-start}
.mb-msg{margin:12px 0 0;padding:10px 12px;border:1px solid var(--line);color:var(--text-2);font-size:13px;white-space:pre-wrap}
.mb-msg.error{border-color:var(--danger);color:var(--text)}
.mb-empty{margin:12px 0;color:var(--dim)}
.mb-add{display:flex;gap:8px;margin-top:12px}
.mb-add input{flex:1;min-width:0;min-height:44px;padding:0 12px;border:1px solid var(--input-line,var(--line));border-radius:0;background:var(--surface);color:var(--text);font:16px var(--mono)}
@media (min-width:900px){.mb-panel{left:auto;width:min(760px,100%);border-left:1px solid var(--line);box-shadow:0 0 40px var(--shadow)}}
`

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}
const base = (folder: string) => folder.split('/').filter(Boolean).pop() || folder
const keyOf = (p: Project) => `${p.machine}\n${p.folder}`
const errText = (e: unknown) => String((e as Error)?.message || e)
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'project'

function loadFolders(): Project[] {
  try { const v = JSON.parse(localStorage.getItem(FOLDERS_KEY) || '[]'); return Array.isArray(v) ? v.filter(p => p && typeof p.folder === 'string') : [] } catch { return [] }
}
function saveFolders(list: Project[]) { try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(list)) } catch { /* storage unavailable */ } }

/** Project folders: where agents run (not the workers' worktrees), coordinators' projects, folders added by hand. */
export function projectsOf(agents: Agent[], added: Project[]): Project[] {
  const out = new Map<string, Project>()
  const add = (p: Project) => { if (p.folder.startsWith('/') && !p.folder.includes(WORKTREES)) out.set(keyOf(p), p) }
  for (const a of agents) {
    if (a.labels['wherdr.project']) add({ machine: a.machine, folder: a.labels['wherdr.project'] })
    else if (a.folder && !a.labels['wherdr.task']) add({ machine: a.machine, folder: a.folder })
  }
  for (const p of added) add(p)
  return [...out.values()].sort((a, b) => base(a.folder).localeCompare(base(b.folder)))
}
const coordinatorOf = (agents: Agent[], p: Project) => agents.find(a => a.machine === p.machine && a.labels['wherdr.role'] === 'coordinator' && a.labels['wherdr.project'] === p.folder)
const workerOf = (agents: Agent[], p: Project, t: Task) => agents.find(a => a.machine === p.machine && a.labels['wherdr.task'] === t.id && a.labels['wherdr.project'] === p.folder)

// The app's words for an agent's state (Ready, not idle).
const agentWord = (s: string | null) => s === 'idle' || s === 'done' ? 'ready' : s === 'blocked' ? 'needs you' : s || 'unknown'

function stateEl(status: string, text = status) {
  const s = el('span', `mb-state ${status}`)
  s.append(el('i'), el('span', '', text))
  return s
}

let cleanup: (() => void) | null = null

export default {
  activate(w: Wherdr) {
    const style = el('style')
    style.id = STYLE_ID
    style.textContent = CSS
    document.head.append(style)

    let agents: Agent[] = []
    let added = loadFolders()
    let panel: HTMLElement | null = null
    let open: Project | null = null
    let board: { file?: TaskFile, error?: string, warnings: string[] } = { warnings: [] }
    let busy = false
    let note: { text: string, error: boolean } | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    // ---- the Board entry on the home
    const entries = new Set<HTMLElement>()
    const attach = () => {
      for (const home of document.querySelectorAll<HTMLElement>(HOME)) {
        if (home.querySelector('.mb-entry')) continue
        const b = el('button', 'mb-entry')
        b.type = 'button'
        b.dataset.miniBoard = 'entry'
        b.innerHTML = ICON_BOARD
        b.append(el('span', '', 'Board'), el('small'))
        b.addEventListener('click', () => showPanel())
        const head = home.querySelector('.home-top')
        if (head) head.after(b)
        else home.prepend(b)
        entries.add(b)
      }
      const n = projectsOf(agents, added).length
      for (const b of entries) {
        if (!b.isConnected) { entries.delete(b); continue }
        const small = b.querySelector('small')!
        const text = n === 1 ? '1 project' : `${n} projects`
        if (small.textContent !== text) small.textContent = text // no change, no mutation: the observer stays quiet
      }
    }

    // ---- the panel
    function showPanel(p: Project | null = null) {
      if (!panel) {
        panel = el('section', 'mb-panel')
        panel.dataset.miniBoard = 'panel'
        panel.setAttribute('role', 'dialog')
        panel.setAttribute('aria-label', 'Board')
        panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') back() })
        document.body.append(panel)
      }
      open = p
      board = { warnings: [] }
      note = null
      render()
      if (p) void reload()
      if (timer) clearInterval(timer)
      timer = p ? setInterval(() => { if (!busy) void reload() }, POLL_MS) : null
    }
    function closePanel() {
      if (timer) clearInterval(timer)
      timer = null
      panel?.remove()
      panel = null
      open = null
    }
    const back = () => (open ? showPanel(null) : closePanel())

    async function reload() {
      const p = open
      if (!p) return
      try {
        const r = parseTasks(await w.files.read(p.machine, tasksPath(p.folder)))
        if (open !== p) return
        board = r.ok ? { file: r.file, warnings: r.warnings } : { error: r.error, warnings: [] }
      } catch (e) {
        if (open !== p) return
        board = { error: errText(e), warnings: [] }
      }
      render()
    }

    async function act(what: () => Promise<void>) {
      busy = true
      note = null
      render()
      try { await what() } catch (e) { note = { text: errText(e), error: true } }
      busy = false
      render()
    }

    // Read again just before writing: the coordinator writes this file too.
    const onAdd = (title: string, description: string) => act(async () => {
      const p = open!
      const r = parseTasks(await w.files.read(p.machine, tasksPath(p.folder)))
      if (!r.ok) throw new Error(`${r.error}. The file was left as it is.`)
      const next = addTask(r.file, title, description)
      await w.files.write(p.machine, tasksPath(p.folder), serializeTasks(next))
      board = { file: next, warnings: r.warnings }
      note = { text: coordinatorOf(agents, p) ? 'Added. If the coordinator has stopped, open it and say "check the tasks".' : 'Added. Start the coordinator to work on it.', error: false }
    })

    const onStart = () => act(async () => {
      const p = open!
      const r = parseTasks(await w.files.read(p.machine, tasksPath(p.folder)))
      if (!r.ok) throw new Error(`${r.error}. Fix the file before starting the coordinator.`)
      // Create the file first so that the coordinator and the Board agree on it.
      if (!board.file) await w.files.write(p.machine, tasksPath(p.folder), serializeTasks(r.file))
      const firstMessage = renderCoordinator(TEMPLATE, { project: p.folder, tasksFile: tasksPath(p.folder), maxWorkers: r.file.maxWorkers })
      const labels = { 'wherdr.role': 'coordinator', 'wherdr.project': p.folder }
      const opts = { machine: p.machine, folder: p.folder, agent: 'claude', firstMessage, labels }
      let started: { id: string }
      try { started = await w.agents.start({ ...opts, name: `coord-${slug(base(p.folder))}` }) } catch (e) {
        if (!/name/i.test(errText(e))) throw e
        started = await w.agents.start(opts) // that name is taken: let core name it
      }
      note = { text: 'Coordinator started: it reads the tasks and starts the workers.', error: false }
      w.agents.open(started.id)
      closePanel()
    })

    function render() {
      if (!panel) return
      const focused = document.activeElement
      const keep = focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement ? focused.dataset.mb : undefined
      const drafts = new Map<string, string>()
      for (const f of panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-mb]')) drafts.set(f.dataset.mb!, f.value)
      panel.replaceChildren()
      const head = el('header', 'mb-head')
      const backBtn = el('button', 'mb-icon')
      backBtn.type = 'button'
      backBtn.innerHTML = ICON_BACK
      backBtn.setAttribute('aria-label', open ? 'Projects' : 'Close board')
      backBtn.addEventListener('click', back)
      head.append(backBtn, el('h2', '', open ? base(open.folder) : 'Board'), el('span', 'mb-exp', 'Experimental'))
      const body = el('div', 'mb-body')
      const inner = el('div', 'mb-inner')
      body.append(inner)
      panel.append(head, body)
      if (open) renderProject(inner, open)
      else renderProjects(inner)
      for (const f of panel.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-mb]')) f.value = drafts.get(f.dataset.mb!) ?? f.value
      if (keep) panel.querySelector<HTMLElement>(`[data-mb="${keep}"]`)?.focus()
      else if (!panel.contains(document.activeElement)) backBtn.focus()
    }

    function renderProjects(inner: HTMLElement) {
      const list = projectsOf(agents, added)
      inner.append(el('p', 'mb-label', 'Projects'))
      if (!list.length) inner.append(el('p', 'mb-empty', 'No project yet. Start an agent in a Git folder, or add the folder below.'))
      const ul = el('ul', 'mb-list')
      for (const p of list) {
        const li = el('li')
        const b = el('button', 'mb-row')
        b.type = 'button'
        b.dataset.project = p.folder
        const main = el('span', 'mb-row-main')
        main.append(el('span', 'mb-title', base(p.folder)), el('span', 'mb-sub', p.machine ? `${p.folder} · other machine` : p.folder))
        b.append(main)
        const c = coordinatorOf(agents, p)
        if (c) b.append(stateEl(c.status || 'unknown', 'Coordinator'))
        b.addEventListener('click', () => showPanel(p))
        li.append(b)
        ul.append(li)
      }
      inner.append(ul)
      const form = el('form', 'mb-add')
      const input = el('input')
      input.dataset.mb = 'folder'
      input.placeholder = '/path/to/project'
      input.setAttribute('aria-label', 'Project folder (absolute path)')
      input.autocapitalize = 'off'
      input.spellcheck = false
      const add = el('button', 'mb-btn', 'Add folder')
      add.type = 'submit'
      form.append(input, add)
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const folder = input.value.trim().replace(/\/+$/, '')
        if (!folder.startsWith('/')) return
        added = [...added.filter(p => !(p.machine === '' && p.folder === folder)), { machine: '', folder }]
        saveFolders(added)
        input.value = ''
        showPanel({ machine: '', folder })
      })
      inner.append(form)
    }

    function renderProject(inner: HTMLElement, p: Project) {
      inner.append(el('p', 'mb-sub mb-path', p.folder))
      // Coordinator
      inner.append(el('p', 'mb-label', 'Coordinator'))
      const coord = el('div', 'mb-coord')
      const c = coordinatorOf(agents, p)
      if (c) {
        coord.append(stateEl(c.status || 'unknown', agentWord(c.status)), el('p', '', c.name || 'Coordinator'))
        const b = el('button', 'mb-btn', 'Open coordinator')
        b.type = 'button'
        b.dataset.miniBoard = 'open-coordinator'
        b.addEventListener('click', () => { w.agents.open(c.id); closePanel() })
        coord.append(b)
      } else {
        coord.append(el('p', '', 'Not running. It reads the tasks, starts up to the worker limit, follows them and never merges.'))
        const b = el('button', 'mb-btn primary', 'Start coordinator')
        b.type = 'button'
        b.dataset.miniBoard = 'start-coordinator'
        b.disabled = busy || Boolean(board.error)
        b.addEventListener('click', () => void onStart())
        coord.append(b)
      }
      inner.append(coord)
      if (note) inner.append(el('p', `mb-msg${note.error ? ' error' : ''}`, note.text))
      if (board.error) inner.append(el('p', 'mb-msg error', `${tasksPath(p.folder)}: ${board.error}`))
      for (const warning of board.warnings) inner.append(el('p', 'mb-msg', warning))

      // New task
      inner.append(el('p', 'mb-label', 'New task'))
      const form = el('form', 'mb-form')
      const title = el('input')
      title.dataset.mb = 'title'
      title.placeholder = 'Title'
      title.setAttribute('aria-label', 'Task title')
      title.maxLength = 200
      const desc = el('textarea')
      desc.dataset.mb = 'desc'
      desc.placeholder = 'Description (optional)'
      desc.setAttribute('aria-label', 'Task description')
      const submit = el('button', 'mb-btn', 'Add task')
      submit.type = 'submit'
      submit.disabled = busy || Boolean(board.error)
      form.append(title, desc, submit)
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        if (!title.value.trim() || busy) return
        const [t, d] = [title.value, desc.value]
        title.value = ''
        desc.value = ''
        void onAdd(t, d)
      })
      inner.append(form)

      // Tasks
      const tasks = board.file?.tasks ?? []
      const counts = STATUSES.map(s => [s, tasks.filter(t => t.status === s).length] as const).filter(([, n]) => n)
      inner.append(el('p', 'mb-label', `Tasks${counts.length ? ` · ${counts.map(([s, n]) => `${n} ${s}`).join(' · ')}` : ''}`))
      if (!board.file && !board.error) inner.append(el('p', 'mb-empty', 'Loading…'))
      else if (board.file && !tasks.length) inner.append(el('p', 'mb-empty', 'No task yet.'))
      const ul = el('ul', 'mb-list')
      ul.dataset.miniBoard = 'tasks'
      for (const t of tasks) {
        const worker = workerOf(agents, p, t)
        const li = el('li')
        const row = el('button', 'mb-row')
        row.type = 'button'
        row.dataset.task = t.id
        row.disabled = !worker
        row.title = worker ? 'Open the worker\'s conversation' : 'No worker running for this task'
        const main = el('span', 'mb-row-main')
        main.append(el('span', 'mb-title', t.title), el('span', 'mb-sub', [t.id, t.branch, t.terminal].filter(Boolean).join(' · ')))
        if (t.notes) main.append(el('span', 'mb-notes', t.notes))
        if (worker) {
          const live = stateEl(worker.status || 'unknown', `Worker ${agentWord(worker.status)}`)
          live.classList.add('mb-live')
          main.append(live)
        }
        row.append(main, stateEl(t.status))
        if (worker) row.addEventListener('click', () => { w.agents.open(worker.id); closePanel() })
        li.append(row)
        ul.append(li)
      }
      inner.append(ul)
    }

    const offState = w.state.subscribe((list) => {
      agents = list
      attach()
      // A new coordinator or worker usually means the file changed too.
      if (panel && !busy) { if (open) void reload(); else render() }
    })
    const observer = new MutationObserver(attach)
    observer.observe(document.body, { childList: true, subtree: true })
    const offNav = w.onNavigate(() => { attach(); if (panel && !location.hash.match(/^#\/?$/)) closePanel() })
    attach()

    cleanup = () => {
      observer.disconnect()
      offNav()
      offState()
      closePanel()
      style.remove()
      for (const b of document.querySelectorAll('.mb-entry')) b.remove()
    }
  },
  // Switched off: the page is back as it was (the tasks file and the agents stay).
  deactivate() {
    cleanup?.()
    cleanup = null
  },
}
