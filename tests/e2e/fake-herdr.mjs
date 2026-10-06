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
const screen = p => (p?.agent === 'omp' && p.status === 'idle' ? OMP_IDLE_SCREEN : '')

// `workspaces`: [{ id, label, panes: [{ id, agent, status, cwd, session, transcript, reply }] }]
// (`session`: the value Herdr's agent integration reports; `transcript`: the file
// the fake agent appends to when it receives a prompt).
export function startFakeHerdr({ sock, workspaces, log = () => {} }) {
  const panes = workspaces.flatMap(w => w.panes.map(p => ({ ...p, workspace: w.id })))
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
        area: { x: 0, y: 0, width: 120, height: 40 },
        focused_pane_id: w.panes[0]?.id,
        panes: w.panes.map((p, i) => ({ pane_id: p.id, focused: i === 0, rect: { x: 0, y: 0, width: 120, height: 40 } })),
        splits: [],
      })),
      panes: panes.map(p => ({
        pane_id: p.id, workspace_id: p.workspace, tab_id: `${p.workspace}:t1`,
        agent: p.agent, agent_status: p.status, cwd: p.cwd, foreground_cwd: p.cwd, focused: false,
        terminal_title: p.agent || 'shell',
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
    await new Promise(r => setTimeout(r, PROMPT_DELAY_MS))
    if (p.agent === 'omp' && p.transcript) {
      const at = Date.now()
      const line = (id, ts, message) => JSON.stringify({ type: 'message', id, timestamp: new Date(ts).toISOString(), message: { ...message, timestamp: ts } })
      fs.appendFileSync(p.transcript, [
        line(`u${at}`, at, { role: 'user', content: [{ type: 'text', text: String(params.text) }], attribution: 'user' }),
        line(`a${at}`, at + 1, { role: 'assistant', content: [{ type: 'text', text: p.reply || 'Noted.' }], stopReason: 'stop' }),
      ].join('\n') + '\n')
    }
    return { agent: { pane_id: p.id, agent: p.agent, status: p.status } }
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
      const procs = p?.agent ? [{ pid: 2001, name: p.agent, argv: [p.agent] }] : []
      return { process_info: { shell_pid: 2000, foreground_processes: procs } }
    },
    'pane.send_input': () => ({}),
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
