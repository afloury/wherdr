// Fake Herdr API server for the end-to-end tests: speaks Herdr's socket
// protocol (line-delimited JSON over a Unix socket, one connection per
// request: {id, method, params} -> {id, result} or {id, error: {code, message}})
// and answers from a fixed in-memory session. No real Herdr is ever involved.
import fs from 'node:fs'
import net from 'node:net'

// Delay of agent.prompt, so the app's "sending…" state is observable.
export const PROMPT_DELAY_MS = 1500

// What an agent's pane shows: a real omp at rest has its input field ("╰─"
// line) on screen, which the app checks before typing a message into it (it
// holds messages while a dialog hides the field). Other panes: blank.
const OMP_IDLE_SCREEN = [
  '',
  ' Ready when you are.',
  '',
  ' π > Opus > demo ▶─1%───────────────────────────────────────────────1M─',
  '╰─ ',
].join('\n')
// omp running the user's "!" command, nerd-font symbols (Escape drawn as
// U+F12B7), as omp 18.6 shows it; Escape cancels it.
const OMP_RULE = '─'.repeat(70)
const ompRunScreen = command => [
  '', OMP_RULE, ` $ ${command}`, '', ' ⠸ Running… (\u{F12B7} to cancel)', OMP_RULE,
  ' π > Opus > demo ▶─1%───────────────────────────────────────────────1M─',
  '╰─ ',
].join('\n')
const screen = p => p?.updateOutput ?? (p?.agent === 'omp' && p.status === 'idle' ? (p.run ? ompRunScreen(p.run) : OMP_IDLE_SCREEN) : '')

// A tab's area, in cells; two panes share it side by side (one split).
const AREA = { x: 0, y: 0, width: 120, height: 40 }
const HALVES = [{ x: 0, y: 0, width: 60, height: 40 }, { x: 61, y: 0, width: 59, height: 40 }]

// `workspaces`: [{ id, label, panes: [{ id, agent, status, cwd, session, transcript, reply, shell }] }]
// (`session`: the value Herdr's agent integration reports; `transcript`: the file
// the fake agent appends to when it receives a prompt; `shell`: a "!" prompt
// starts a run that lasts until Escape, written nowhere, like a fresh omp).
export function startFakeHerdr({ sock, workspaces, log = () => {} }) {
  // `size`: the pane's PTY. No Herdr client is attached to this session: a
  // terminal control session resizes it, and it keeps that size afterwards.
  // `control`: the control session attached to the pane's terminal, if any.
  const panes = workspaces.flatMap(w => w.panes.map((p, i) => {
    const rect = w.panes.length === 2 ? HALVES[i] : AREA
    return { ...p, workspace: w.id, size: { cols: rect.width, rows: rect.height }, control: null }
  }))
  const paneById = id => panes.find(p => p.id === id)

  function snapshot() {
    return {
      version: 'e2e',
      workspaces: workspaces.map((w, i) => ({
        workspace_id: w.id, label: w.label, number: i + 1, focused: i === 0,
        agent_status: w.panes[0]?.status || 'unknown', active_tab_id: `${w.id}:t1`,
        tab_count: 1, pane_count: w.panes.length,
      })),
      tabs: workspaces.map(w => ({
        tab_id: `${w.id}:t1`, workspace_id: w.id, label: '1', number: 1, focused: true,
        agent_status: w.panes[0]?.status || 'unknown', pane_count: w.panes.length,
      })),
      layouts: workspaces.map(w => ({
        tab_id: `${w.id}:t1`, workspace_id: w.id, zoomed: false,
        area: AREA,
        focused_pane_id: w.panes[0]?.id,
        panes: w.panes.map((p, i) => ({ pane_id: p.id, focused: i === 0, rect: w.panes.length === 2 ? HALVES[i] : AREA })),
        splits: w.panes.length === 2 ? [{ id: 'split_0_root', direction: 'right', ratio: 0.5, rect: AREA }] : [],
      })),
      panes: panes.map(p => ({
        pane_id: p.id, workspace_id: p.workspace, tab_id: `${p.workspace}:t1`,
        agent: p.agent, agent_status: p.status, cwd: p.cwd, foreground_cwd: p.cwd, focused: false,
        terminal_title: p.agent || 'shell',
        terminal_id: `term_${p.id.replace(/\W/g, '')}`,
        scroll: { viewport_rows: p.size.rows, offset_from_bottom: 0, max_offset_from_bottom: 0 },
        ...(p.session ? { agent_session: { agent: p.agent, value: p.session } } : {}),
      })),
      agents: [],
    }
  }

  // The fake agent "reads" the prompt: the message, then a short reply, land in
  // its transcript (omp format) once the delay is over.
  async function prompt(params) {
    const p = paneById(params.target)
    if (!p) throw Object.assign(new Error(`No pane ${params.target}`), { code: 'pane_not_found' })
    p.prompts = [...(p.prompts || []), params]
    await new Promise(r => setTimeout(r, PROMPT_DELAY_MS))
    if (p.shell && /^\s*!/.test(String(params.text))) p.run = String(params.text).replace(/^\s*!+\s*/, '')
    else if (p.agent === 'omp' && p.transcript) {
      const at = Date.now()
      const line = (id, ts, message) => JSON.stringify({ type: 'message', id, timestamp: new Date(ts).toISOString(), message: { ...message, timestamp: ts } })
      fs.appendFileSync(p.transcript, [
        line(`u${at}`, at, { role: 'user', content: [{ type: 'text', text: String(params.text) }], attribution: 'user' }),
        line(`a${at}`, at + 1, { role: 'assistant', content: [{ type: 'text', text: p.reply || 'Noted.' }], stopReason: 'stop' }),
      ].join('\n') + '\n')
    }
    return { agent: { pane_id: p.id, agent: p.agent, status: p.status } }
  }

  function need(id) {
    const p = paneById(id)
    if (!p) throw Object.assign(new Error(`No pane ${id}`), { code: 'pane_not_found' })
    return p
  }

  const methods = {
    'session.snapshot': () => ({ snapshot: snapshot() }),
    'agent.prompt': prompt,
    'agent.get': (params) => {
      const p = paneById(params.target)
      if (!p) throw Object.assign(new Error(`No agent ${params.target}`), { code: 'agent_not_found' })
      return { agent: { pane_id: p.id, agent: p.agent, status: p.status } }
    },
    'pane.get': (params) => {
      const p = paneById(params.pane_id)
      if (!p) throw Object.assign(new Error(`No pane ${params.pane_id}`), { code: 'pane_not_found' })
      return { pane: snapshot().panes.find(x => x.pane_id === p.id) }
    },
    'pane.read': params => ({ read: { pane_id: params.pane_id, source: params.source || 'visible', text: screen(paneById(params.pane_id)) } }),
    'pane.process_info': (params) => {
      const p = paneById(params.pane_id)
      if (p) p.processReads = (p.processReads || 0) + 1
      const procs = p?.agent ? [{ pid: p.pid || 2001, name: p.agent, argv: p.argv || [p.agent, ...(p.agent === 'codex' ? ['--profile', 'work', '-m', 'gpt-x'] : [])] }] : [{ pid: 2000, name: 'zsh' }]
      return { process_info: { shell_pid: 2000, foreground_process_group_id: p?.foreground ? 4000 : p?.agent ? (p.pid || 2001) : 2000, foreground_processes: procs } }
    },
    'e2e.update_reset': params => {
      const p = need(params.pane_id)
      p.agent = 'codex'; p.status = 'idle'; p.pid = (p.pid || 3000) + 1
      p.updateOutput = params.session ? '' : '✨ Update available! 0.148.0 -> 0.162.1'; p.foreground = false; p.starts = []
      p.processReads = 0
      p.argv = null; p.writes = []; p.prompts = []
      p.baseCwd ||= p.cwd
      p.cwd = params.session ? p.baseCwd : `${p.baseCwd}/fresh`
      p.session = params.session || null
      return { pid: p.pid }
    },
    'e2e.update_exit': params => {
      const p = need(params.pane_id)
      p.agent = null; p.status = 'unknown'; p.session = null
      p.updateOutput = 'Codex CLI 0.162.1 installed successfully.\n\n🎉 Update ran successfully! Please restart Codex.\n\nuser@host project % ' + (params.draft || '')
      return {}
    },
    'e2e.update_replace': params => {
      const p = need(params.pane_id)
      p.pid++; p.argv = params.argv
      return { pid: p.pid }
    },
    'e2e.update_session': params => { need(params.pane_id).session = params.session; return {} },
    'e2e.update_draft': params => { need(params.pane_id).updateOutput += params.text; return {} },
    'e2e.update_foreground': params => { need(params.pane_id).foreground = true; return {} },
    'e2e.update_starts': params => {
      const p = need(params.pane_id)
      return { starts: p.starts || [], reads: p.processReads || 0, writes: p.writes || [], prompts: p.prompts || [] }
    },
    'agent.start': params => {
      const p = need(params.pane_id)
      p.starts = [...(p.starts || []), params]
      p.agent = params.kind; p.status = 'idle'; p.pid = (p.pid || 3000) + 1; p.updateOutput = params.kind === 'codex' ? '› ' : ''
      return { agent: { pane_id: p.id, agent: p.agent } }
    },
    'pane.send_input': (params) => {
      const p = paneById(params.pane_id)
      if (p) p.writes = [...(p.writes || []), params]
      if (p?.run && (params.keys || []).includes('esc')) p.run = null
      return {}
    },
    'pane.layout': (params) => {
      const p = need(params.pane_id)
      return { layout: snapshot().layouts.find(l => l.workspace_id === p.workspace) }
    },
    // Control session of a pane's terminal (tests/e2e/fake-herdr-cli.mjs).
    'e2e.term_attach': (params) => {
      const p = need(params.pane_id)
      if (p.control && !params.takeover) throw Object.assign(new Error('terminal already has an attached client'), { code: 'terminal_attached' })
      p.control = params.session
      p.size = { cols: params.cols || p.size.cols, rows: params.rows || p.size.rows }
      return p.size
    },
    'e2e.term_resize': (params) => {
      const p = need(params.pane_id)
      if (p.control !== params.session) throw Object.assign(new Error('not attached'), { code: 'terminal_not_attached' })
      p.size = { cols: params.cols, rows: params.rows }
      return p.size
    },
    'e2e.term_detach': (params) => {
      const p = need(params.pane_id)
      if (p.control === params.session) p.control = null
      return {}
    },
    // What the specs look at: the pane's PTY size, and whether its terminal is held.
    'e2e.pane_size': (params) => {
      const p = need(params.pane_id)
      return { ...p.size, attached: Boolean(p.control) }
    },
    'plugin.list': () => ({ plugins: [] }),
    'plugin.action.list': () => ({ actions: [] }),
  }

  async function answer(raw) {
    let req
    try { req = JSON.parse(raw) }
    catch { return { id: null, error: { code: 'bad_request', message: 'Invalid JSON' } } }
    const fn = methods[req.method]
    if (!fn) {
      log(`fake herdr: unknown method ${req.method}`)
      return { id: req.id, error: { code: 'unknown_method', message: `Unknown method ${req.method}` } }
    }
    try { return { id: req.id, result: await fn(req.params || {}) } }
    catch (e) { return { id: req.id, error: { code: e.code || 'internal', message: e.message } } }
  }

  try { fs.unlinkSync(sock) }
  catch { /* no stale socket */ }
  const server = net.createServer((conn) => {
    let buf = ''
    conn.setEncoding('utf8')
    conn.on('error', () => {})
    conn.on('data', async (chunk) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      const line = buf.slice(0, nl)
      buf = ''
      const res = await answer(line)
      if (!conn.destroyed) conn.end(JSON.stringify(res) + '\n')
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sock, () => resolve(server))
  })
}
