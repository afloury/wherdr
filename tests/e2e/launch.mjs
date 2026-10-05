// Starts the end-to-end environment (Playwright webServer): a fake HOME with
// neutral transcripts, an empty data dir, the fake Herdr socket server, then
// the built app (.output/) pointed at them. Everything is removed on exit.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startFakeHerdr } from './fake-herdr.mjs'
import { PORT, writeScenario } from './scenario.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const entry = path.join(root, '.output/server/index.mjs')
if (!fs.existsSync(entry)) {
  console.error('e2e: .output/ is missing, run `npm run build` first')
  process.exit(1)
}

// HOME and data under the repo (.e2e-tmp, git-ignored); the socket under the
// system temp dir: a Unix socket path is limited to ~104 bytes.
const tmp = path.join(root, '.e2e-tmp')
fs.rmSync(tmp, { recursive: true, force: true })
const home = path.join(tmp, 'home')
const data = path.join(tmp, 'data')
fs.mkdirSync(home, { recursive: true })
fs.mkdirSync(data, { recursive: true })
fs.writeFileSync(path.join(data, 'push.json'), JSON.stringify({ subs: [] }))
const sockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wherdr-e2e-'))
const sock = path.join(sockDir, 'herdr.sock')
// The herdr CLI (worktrees, machines, notifications…): a stub that always fails.
const bin = path.join(tmp, 'bin/herdr')
fs.mkdirSync(path.dirname(bin), { recursive: true })
fs.writeFileSync(bin, '#!/bin/sh\necho "herdr is not available in the e2e tests" >&2\nexit 1\n', { mode: 0o755 })

const workspaces = writeScenario(home)
const server = await startFakeHerdr({ sock, workspaces, log: m => console.log(m) })

const app = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    HOME: home,
    DATA_DIR: data,
    HOST: '127.0.0.1',
    PORT: String(PORT),
    HOST_LABEL: 'devbox',
    HERDR_SOCK: sock,
    HERDR_CLIENT_SOCK: path.join(sockDir, 'herdr-client.sock'),
    HERDR_BIN: bin,
    HERDR_WEB_SESSION: 'e2e',
    HERDR_WEB_MACHINES: 'off',
    WHERDR_UPDATE_CHECK: 'off',
    WHERDR_RUNTIME_DIR: path.join(sockDir, 'run'),
    TZ: 'UTC',
  },
})

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (app.exitCode === null) app.kill('SIGTERM')
  server.close()
  fs.rmSync(sockDir, { recursive: true, force: true })
  fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(code)
}
app.on('exit', (code, signal) => stop(signal ? 0 : code ?? 1))
