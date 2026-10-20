import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installService, serviceFile } from '../bin/lib/service.mjs'

// systemd only (this runs on Linux and macOS CI alike: the platform is the runner's).
const linux = process.platform === 'linux'
const spec = { runtime: '/opt/node/bin/node', args: ['/w/bin/wherdr.mjs', 'run'], env: { PATH: '/new/agent/bin:/usr/bin' }, log: '' }
let home = ''
let xdg: string | undefined
beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-svc-'))
  spec.log = path.join(home, 'wherdr/wherdr.log')
  xdg = process.env.XDG_CONFIG_HOME
  delete process.env.XDG_CONFIG_HOME
})
afterEach(() => {
  if (xdg !== undefined) process.env.XDG_CONFIG_HOME = xdg
  rmSync(home, { recursive: true, force: true })
})
// A systemctl that fails at `step`, and records every call.
function systemctl(step: 'daemon-reload' | 'enable' | null) {
  const calls: string[] = []
  return {
    calls,
    run: (cmd: string, args: string[]) => {
      calls.push([cmd, ...args].join(' '))
      return args[1] === step ? { ok: false, out: `${step} failed`, missing: false } : { ok: true, out: '', missing: false }
    },
  }
}

describe.runIf(linux)('installing the login service (systemd)', () => {
  it('writes the unit with the PATH it is given, and enables it', () => {
    const s = systemctl(null)
    const file = installService(spec, home, s.run)
    expect(file).toBe(serviceFile(home))
    expect(readFileSync(file, 'utf8')).toContain('Environment="PATH=/new/agent/bin:/usr/bin"')
    expect(s.calls).toEqual(['systemctl --user daemon-reload', 'systemctl --user enable --now wherdr.service'])
  })

  it('leaves no unit behind when systemd refuses a first one', () => {
    for (const step of ['daemon-reload', 'enable'] as const) {
      const s = systemctl(step)
      expect(() => installService(spec, home, s.run)).toThrow(`${step} failed`)
      expect(existsSync(serviceFile(home)!)).toBe(false)
      // systemd forgets it too.
      expect(s.calls.at(-1)).toBe('systemctl --user daemon-reload')
    }
  })

  it('puts the previous unit back when replacing it fails', () => {
    const file = serviceFile(home)!
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, 'Environment="PATH=/old/agent/bin"\n')
    expect(() => installService(spec, home, systemctl('enable').run)).toThrow('enable failed')
    expect(readFileSync(file, 'utf8')).toBe('Environment="PATH=/old/agent/bin"\n')
    // A later run replaces it with the PATH of now.
    installService(spec, home, systemctl(null).run)
    expect(readFileSync(file, 'utf8')).toContain('/new/agent/bin')
  })
})
