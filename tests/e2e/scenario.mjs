// The fake session the end-to-end tests run against: its panes, and the
// neutral transcripts written into the fake HOME. Shared by the launcher and the specs.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const PORT = Number(process.env.E2E_PORT || 7699)
export const BASE_URL = `http://127.0.0.1:${PORT}`

// Pane ids (Herdr format <workspace>:<pane>).
export const CLAUDE_PANE = 'w1:p1'
export const OMP_LONG_PANE = 'w2:p1'
export const OMP_CHAT_PANE = 'w3:p1'
export const OMP_IMAGE_PANE = 'w4:p1'
export const OMP_APPROVAL_PANE = 'w5:p1'

// Unique markers of the long omp transcript (asserted on by the specs).
export const LONG_WORD = `Pneumono${'ultramicroscopicsilicovolcano'.repeat(12)}coniosis`
export const LONG_URL = `https://example.com/acme-api/releases/${'nested-segment/'.repeat(24)}changelog.html?ref=${'abcdef0123456789'.repeat(6)}`
export const LONG_END = 'End of the long build report.'

const iso = ts => new Date(ts).toISOString()

// A 240×150 gradient PNG: the image an omp `read` returns in the image scenario.
function gradientPng(w = 240, h = 150) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf) => {
    let c = 0xFFFFFFFF
    for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8)
    return (c ^ 0xFFFFFFFF) >>> 0
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = Math.round(255 * x / w)
      raw[o + 1] = Math.round(255 * y / h)
      raw[o + 2] = 160
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const jsonl = lines => lines.map(l => JSON.stringify(l)).join('\n') + '\n'

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

// Claude Code: ~/.claude/projects/<cwd with / and . as ->/<session id>.jsonl.
function claudeTranscript(home, cwd, sid, now) {
  const enc = cwd.replace(/[/.]/g, '-')
  const file = path.join(home, '.claude/projects', enc, `${sid}.jsonl`)
  const base = { isSidechain: false, cwd, sessionId: sid }
  write(file, jsonl([
    { ...base, type: 'user', timestamp: iso(now - 60000), message: { role: 'user', content: 'After updating a user, GET /users/:id still returns the old name. Find out why.' } },
    { ...base, type: 'assistant', timestamp: iso(now - 50000), message: { model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'text', text: '`getUser` caches users forever and `updateUser` never clears the entry. I will add an expiry and clear it on update.' }] } },
  ]))
}

// omp: ~/.omp/agent/sessions/<encoded cwd>/<date>_<id>.jsonl.
function ompTranscript(home, cwd, id, now, entries) {
  const enc = `-${cwd.replace(/^\//, '').replace(/[/.]/g, '-')}-`
  const file = path.join(home, '.omp/agent/sessions', enc, `${iso(now - 120000).replace(/[:.]/g, '-')}_${id}.jsonl`)
  let t = now - 120000
  const msg = (message) => {
    t += 1000
    return { type: 'message', id: `m${t}`, timestamp: iso(t), message: { ...message, timestamp: t } }
  }
  write(file, jsonl([{ type: 'session', version: 3, id, timestamp: iso(now - 120000), cwd }, ...entries(msg)]))
  return file
}

function longContent(msg) {
  const wideCode = `const endpoints = [${Array.from({ length: 14 }, (_, i) => `'/v1/resources/${i}/sub-resources/details'`).join(', ')}]`
  const head = '| Endpoint | Method | Median latency | p99 latency | Error rate | Owner team | Notes |'
  const sep = '|---|---|---|---|---|---|---|'
  const rows = Array.from({ length: 5 }, (_, i) =>
    `| /v1/resources/${i}/sub-resources/details-with-a-long-name | GET | ${12 + i} ms | ${140 + i} ms | 0.0${i} % | platform-reliability-and-observability | cached-response-without-invalidation-${i} |`)
  const toolOut = Array.from({ length: 40 }, (_, i) =>
    `[build] step ${String(i + 1).padStart(2, '0')}/40 ${'compiling-module-with-a-very-long-identifier/'.repeat(6)}index.ts ok`).join('\n')
  return [
    msg({ role: 'user', content: [{ type: 'text', text: 'Run the build and summarize the endpoints report.' }], attribution: 'user' }),
    msg({ role: 'assistant', content: [{ type: 'toolCall', id: 'call-build', name: 'bash', arguments: { i: 'Running the verbose build', command: `npm run build -- --verbose --filter=${'packages/acme-api-'.repeat(8)}core` } }], stopReason: 'toolUse' }),
    msg({ role: 'toolResult', toolCallId: 'call-build', toolName: 'bash', content: [{ type: 'text', text: `${toolOut}\n\nWall time: 4.20 seconds` }], details: { wallTimeMs: 4200 }, isError: false }),
    msg({
      role: 'assistant',
      stopReason: 'stop',
      content: [{
        type: 'text',
        text: [
          `The build passes. One unbroken token from the log: ${LONG_WORD}`,
          `Full report: ${LONG_URL}`,
          '```js', wideCode, '```',
          head, sep, ...rows,
          '',
          LONG_END,
        ].join('\n\n').replace(/\n\n(?=\|)/g, '\n'),
      }],
    }),
  ]
}

// Writes the fake HOME and returns the workspaces served by the fake Herdr.
export function writeScenario(home) {
  const now = Date.now()
  const api = path.join(home, 'projects/acme-api')
  const docs = path.join(home, 'projects/docs-site')
  const demo = path.join(home, 'projects/demo')
  const screens = path.join(home, 'projects/screens')
  const approval = path.join(home, 'projects/approval')
  for (const d of [api, docs, demo, screens, approval]) fs.mkdirSync(d, { recursive: true })

  const claudeSid = '00000000-0000-4000-8000-000000000001'
  claudeTranscript(home, api, claudeSid, now)
  const longFile = ompTranscript(home, docs, 'e2e-long', now, longContent)
  const chatFile = ompTranscript(home, demo, 'e2e-chat', now, msg => [
    msg({ role: 'user', content: [{ type: 'text', text: 'Are you ready?' }], attribution: 'user' }),
    msg({ role: 'assistant', content: [{ type: 'text', text: 'Ready when you are.' }], stopReason: 'stop' }),
  ])
  // An omp `read` of a PNG, then enough calls to fold it out of the console.
  const png = gradientPng()
  const hash = crypto.createHash('sha256').update(png).digest('hex')
  write(path.join(home, '.omp/agent/blobs', hash), png)
  const imageFile = ompTranscript(home, screens, 'e2e-image', now, msg => [
    msg({ role: 'user', content: [{ type: 'text', text: 'Check the login screenshot.' }], attribution: 'user' }),
    msg({ role: 'assistant', content: [{ type: 'toolCall', id: 'call-read', name: 'read', arguments: { i: 'Reading the screenshot', path: `${screens}/login.png` } }], stopReason: 'toolUse' }),
    msg({ role: 'toolResult', toolCallId: 'call-read', toolName: 'read', content: [{ type: 'text', text: '' }, { type: 'image', mimeType: 'image/png', data: `blob:sha256:${hash}` }] }),
    ...['ls', 'git status', 'npm test'].flatMap((command, k) => [
      msg({ role: 'assistant', content: [{ type: 'toolCall', id: `call-${k}`, name: 'bash', arguments: { command } }], stopReason: 'toolUse' }),
      msg({ role: 'toolResult', toolCallId: `call-${k}`, toolName: 'bash', content: [{ type: 'text', text: 'ok' }] }),
    ]),
    msg({ role: 'assistant', content: [{ type: 'text', text: 'The login button is clipped.' }], stopReason: 'stop' }),
  ])
  // omp waiting for the approval of its first action (status "blocked").
  const approvalFile = ompTranscript(home, approval, 'e2e-approval', now, msg => [
    msg({ role: 'user', content: [{ type: 'text', text: 'Clean the build folder.' }], attribution: 'user' }),
    msg({ role: 'assistant', content: [{ type: 'toolCall', id: 'call-rm', name: 'bash', arguments: { i: 'Removing the build folder', command: 'rm -rf build' } }], stopReason: 'toolUse' }),
  ])
  // "/" menu: a project skill and a project command for Claude, a project command for omp.
  write(path.join(api, '.claude/skills/daily-notes/SKILL.md'), '---\nname: daily-notes\ndescription: Write the daily notes of the project\n---\nSteps.\n')
  write(path.join(api, '.claude/commands/daily-check.md'), '# Check the daily build\n')
  write(path.join(demo, '.omp/commands/daily-sync.md'), '---\ndescription: Sync the daily branch\n---\nSync.\n')

  return [
    { id: 'w1', label: 'acme-api', panes: [{ id: CLAUDE_PANE, agent: 'claude', status: 'idle', cwd: api, session: claudeSid }] },
    { id: 'w2', label: 'docs-site', panes: [{ id: OMP_LONG_PANE, agent: 'omp', status: 'idle', cwd: docs, session: longFile }] },
    { id: 'w3', label: 'demo', panes: [{ id: OMP_CHAT_PANE, agent: 'omp', status: 'idle', cwd: demo, session: chatFile, transcript: chatFile, reply: 'Got it.' }] },
    { id: 'w4', label: 'screens', panes: [{ id: OMP_IMAGE_PANE, agent: 'omp', status: 'idle', cwd: screens, session: imageFile }] },
    { id: 'w5', label: 'approval', panes: [{ id: OMP_APPROVAL_PANE, agent: 'omp', status: 'blocked', cwd: approval, session: approvalFile }] },
  ]
}
