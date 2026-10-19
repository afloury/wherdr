// The real Tailscale reader (bin/lib/tailnet.mjs tailnetFacts) through a fake
// `tailscale` CLI, feeding wherdr's network decision: Funnel active → status
// error → Serve unreadable → recovery. A reading that shows Funnel refuses
// connections from this computer, over HTTP and WebSocket alike, until a
// valid reading shows it gone; when Funnel was never seen, a failed reading
// proves nothing and serves them (the server log warns).
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { tailnetFacts } from '../bin/lib/tailnet.mjs'
import { checkClient, gateDecision, netContext, refreshTailscale, resetNetworkStateForTests } from '../server/utils/network'

const dir = mkdtempSync(path.join(tmpdir(), 'wherdr-fake-tailscale-'))
const bin = path.join(dir, 'tailscale')
// `status --json` prints status.json, `serve status --json` prints serve.json;
// a missing file makes the command fail, a file named *.bad prints garbage.
writeFileSync(bin, `#!/bin/sh
d='${dir}'
if [ "$1" = status ]; then f="$d/status.json"; else f="$d/serve.json"; fi
[ -f "$f.bad" ] && { echo 'tailscale: unexpected output'; exit 0; }
[ -f "$f" ] || { echo 'failed to connect to local tailscaled' >&2; exit 1; }
cat "$f"
`)
chmodSync(bin, 0o755)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => resetNetworkStateForTests())

const host = 'box.example.ts.net'
const RUNNING = JSON.stringify({ BackendState: 'Running', Self: { TailscaleIPs: ['100.90.1.2'] }, Peer: {} })
const FUNNEL_TLS = JSON.stringify({ TCP: { 443: { TCPForward: '127.0.0.1:7683', TerminateTLS: host } }, AllowFunnel: { [`${host}:443`]: true } })
const SERVE_ONLY = JSON.stringify({ Web: { [`${host}:7683`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:7683' } } } }, TCP: { 7683: { HTTPS: true } } })
const set = (status: string | null, serve: string | null, bad: { status?: boolean, serve?: boolean } = {}) => {
  for (const [name, body, isBad] of [['status.json', status, bad.status], ['serve.json', serve, bad.serve]] as const) {
    rmSync(path.join(dir, name), { force: true })
    rmSync(path.join(dir, `${name}.bad`), { force: true })
    if (body !== null) writeFileSync(path.join(dir, name), body)
    if (isBad) writeFileSync(path.join(dir, `${name}.bad`), '')
  }
}

let t = 5_000_000
async function readAndDecide() {
  t += 10_000
  await refreshTailscale(() => tailnetFacts(7683, bin, null), t, false)
  const check = checkClient('127.0.0.1', {}, netContext(t + 1))
  const base = { check, unlocked: true, hostOk: true, crossSite: false }
  return { zone: check.ok ? check.zone : null, http: gateDecision({ ...base, path: '/api/config' }), ws: gateDecision({ ...base, path: '/ws', ws: true }) }
}
const CLOSED = { zone: null, http: 'network', ws: 'network' }
const OPEN = { zone: 'local', http: 'ok', ws: 'ok' }

describe('Funnel protection through the real reader', () => {
  it('stays closed from Funnel active, through a failed status and an unreadable Serve, until a valid reading', async () => {
    set(RUNNING, FUNNEL_TLS)
    expect(await tailnetFacts(7683, bin, null)).toMatchObject({ readable: true, running: true, funnel: true })
    expect(await readAndDecide()).toEqual(CLOSED)
    // `tailscale status` fails: not "stopped", but unknown; Funnel is kept.
    set(null, FUNNEL_TLS)
    expect(await tailnetFacts(7683, bin, null)).toMatchObject({ readable: false, funnel: null })
    expect(await readAndDecide()).toEqual(CLOSED)
    // Status prints garbage.
    set(RUNNING, FUNNEL_TLS, { status: true })
    expect(await readAndDecide()).toEqual(CLOSED)
    // Status fine, Serve fails, then prints garbage.
    set(RUNNING, null)
    expect(await tailnetFacts(7683, bin, null)).toMatchObject({ readable: true, funnel: null })
    expect(await readAndDecide()).toEqual(CLOSED)
    set(RUNNING, SERVE_ONLY, { serve: true })
    expect(await readAndDecide()).toEqual(CLOSED)
    // Recovery: a valid Serve configuration without Funnel to wherdr.
    set(RUNNING, SERVE_ONLY)
    expect(await readAndDecide()).toEqual(OPEN)
    // And Funnel back on: closed again at the next reading.
    set(RUNNING, FUNNEL_TLS)
    expect(await readAndDecide()).toEqual(CLOSED)
  })

  it('sees Funnel TCP/TLS aimed at 0.0.0.0 (which reaches a server on 127.0.0.1)', async () => {
    set(RUNNING, JSON.stringify({ TCP: { 443: { TCPForward: '0.0.0.0:7683', TerminateTLS: host } }, AllowFunnel: { [`${host}:443`]: true } }))
    expect(await readAndDecide()).toEqual(CLOSED)
    set(RUNNING, JSON.stringify({ TCP: { 443: { TCPForward: 'unix:/run/x.sock' } }, AllowFunnel: { [`${host}:443`]: true } }))
    expect(await readAndDecide()).toEqual(CLOSED)
    // Funnel to another service's port: wherdr is not reached, it stays open.
    const other = JSON.stringify({ TCP: { 443: { TCPForward: '127.0.0.1:3000' } }, AllowFunnel: { [`${host}:443`]: true } })
    set(RUNNING, other)
    expect(await readAndDecide()).toEqual(OPEN)
    // The reader still reports that some Funnel route exists (warned in Docker
    // without WHERDR_DOCKER_LOOPBACK_ONLY, where the host's port is unknown).
    expect(await tailnetFacts(7683, bin, null)).toMatchObject({ funnel: false, funnelAny: true })
    set(RUNNING, SERVE_ONLY)
    expect(await tailnetFacts(7683, bin, null)).toMatchObject({ funnel: false, funnelAny: false })
  })

  it('serves this computer when Serve cannot be read at the first reading', async () => {
    set(RUNNING, null)
    expect(await readAndDecide()).toEqual(OPEN)
  })

  it('opens when Tailscale reports itself stopped (it relays nothing then)', async () => {
    set(JSON.stringify({ BackendState: 'Stopped' }), null)
    expect(await readAndDecide()).toEqual(OPEN)
  })
})
