import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { context, openAddress } from '../bin/lib/commands.mjs'
import { parseArgs, parseEnvFile, portTaken, serverEnv } from '../bin/lib/core.mjs'
import { runtimeCandidates, temporaryInstall } from '../bin/lib/runtime.mjs'
import { launchdPlist, systemdUnit } from '../bin/lib/service.mjs'

describe('wherdr command line', () => {
  it('runs in the foreground without a command', () => {
    expect(parseArgs([])).toEqual({ command: 'run' })
    expect(parseArgs(['--port', '7690'])).toEqual({ command: 'run', port: '7690' })
  })

  it('reads commands, --name value and --name=value', () => {
    expect(parseArgs(['start', '--port', '7690', '--host=0.0.0.0', '--data-dir', '/srv/w', '--session=test']))
      .toEqual({ command: 'start', port: '7690', host: '0.0.0.0', dataDir: '/srv/w', session: 'test' })
    expect(parseArgs(['logs', '-f', '-n', '20'])).toEqual({ command: 'logs', follow: true, lines: '20' })
    expect(parseArgs(['service', 'install'])).toEqual({ command: 'service', sub: 'install' })
    expect(parseArgs(['status', '-h']).command).toBe('help')
    expect(parseArgs(['--version']).command).toBe('version')
  })

  it('rejects unknown commands and options, missing values and bad ports', () => {
    expect(() => parseArgs(['strat'])).toThrow('unknown command: strat')
    expect(() => parseArgs(['service'])).toThrow('wherdr service install|uninstall')
    expect(() => parseArgs(['status', 'now'])).toThrow('unexpected argument: now')
    expect(() => parseArgs(['--prot', '1'])).toThrow('unknown option: --prot')
    expect(() => parseArgs(['--port'])).toThrow('--port needs a value')
    expect(() => parseArgs(['--session', '--port', '1'])).toThrow('--session needs a value')
    expect(() => parseArgs(['--port', '80a'])).toThrow('must be a number')
    expect(() => parseArgs(['--port=70000'])).toThrow('between 1 and 65535')
  })
})

describe('wherdr server environment', () => {
  const home = '/home/test'

  it('defaults to loopback, port 7683 and ~/wherdr/data', () => {
    const env = serverEnv({}, {}, home)
    expect(env).toMatchObject({ PORT: '7683', HOST: '127.0.0.1', DATA_DIR: '/home/test/wherdr/data', WHERDR_INSTALL: 'npm', NODE_ENV: 'production' })
    expect(env.HERDR_WEB_SESSION).toBeUndefined()
    expect(serverEnv({}, { WHERDR_DIR: '~/w2' }, home).DATA_DIR).toBe('/home/test/w2/data')
  })

  it('tells each installation apart for the update offered in the app', () => {
    expect(serverEnv({}, {}, home, '/opt/homebrew/Cellar/wherdr/1.3.0/libexec/lib/node_modules/wherdr/bin/wherdr.mjs').WHERDR_INSTALL).toBe('brew')
    expect(serverEnv({}, {}, home, '/home/linuxbrew/.linuxbrew/Cellar/wherdr/1.3.0/libexec/lib/node_modules/wherdr/bin/wherdr.mjs').WHERDR_INSTALL).toBe('brew')
    expect(serverEnv({}, {}, home, '/opt/homebrew/lib/node_modules/wherdr/bin/wherdr.mjs').WHERDR_INSTALL).toBe('npm-global')
    expect(serverEnv({}, {}, home, '/home/test/.npm/_npx/0a1b2c/node_modules/wherdr/bin/wherdr.mjs').WHERDR_INSTALL).toBe('npm')
    expect(serverEnv({}, {}, home, '/home/test/.npm/_npx/0a1b2c/lib/node_modules/wherdr/bin/wherdr.mjs').WHERDR_INSTALL).toBe('npm')
    // The copy the Herdr plugin runs, in the wherdr folder (WHERDR_DIR included).
    expect(serverEnv({}, {}, home, '/home/test/wherdr/app/bin/wherdr.mjs').WHERDR_INSTALL).toBe('plugin')
    expect(serverEnv({}, { WHERDR_DIR: '/srv/w' }, home, '/srv/w/app/bin/wherdr.mjs')).toMatchObject({ WHERDR_INSTALL: 'plugin', WHERDR_DIR: '/srv/w' })
    expect(serverEnv({}, { WHERDR_DIR: '/srv/w' }, home, '/home/test/wherdr/app/bin/wherdr.mjs').WHERDR_INSTALL).toBe('npm')
  })

  it('lets options win over the environment, and the environment over the defaults', () => {
    const fromEnv = serverEnv({}, { PORT: '7691', HOST: '::1', DATA_DIR: '~/elsewhere', HERDR_WEB_SESSION: 's1' }, home)
    expect(fromEnv).toMatchObject({ PORT: '7691', HOST: '::1', DATA_DIR: '/home/test/elsewhere', HERDR_WEB_SESSION: 's1' })
    const fromOpts = serverEnv({ port: '7692', host: '127.0.0.2', dataDir: '/srv/w', session: 's2' }, { PORT: '7691', HERDR_WEB_SESSION: 's1' }, home)
    expect(fromOpts).toMatchObject({ PORT: '7692', HOST: '127.0.0.2', DATA_DIR: '/srv/w', HERDR_WEB_SESSION: 's2' })
  })

  it('drops NITRO_PORT / NITRO_HOST, which Nitro would read before PORT / HOST', () => {
    const env = serverEnv({ port: '7693' }, { NITRO_PORT: '3000', NITRO_HOST: '0.0.0.0' }, home)
    expect(env.NITRO_PORT).toBeUndefined()
    expect(env.NITRO_HOST).toBeUndefined()
    expect(env.PORT).toBe('7693')
  })

  it('reads KEY=VALUE settings files', () => {
    expect(parseEnvFile('# phone\nAPP_URL="https://m.example.ts.net:7683/"\n\nexport HOST_LABEL=pi\nnot a line\n'))
      .toEqual({ APP_URL: 'https://m.example.ts.net:7683/', HOST_LABEL: 'pi' })
  })
})

describe('command context', () => {
  let dir: string
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('takes options, then the environment, then wherdr.env, then the last start', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'wherdr-ctx-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'wherdr.json'), JSON.stringify({ port: '7695', host: '127.0.0.1', session: 'saved' }))
    const env = { WHERDR_DIR: dir }
    expect(context({}, env, '/home/test')).toMatchObject({ port: '7695', url: 'http://localhost:7695', env: { HERDR_WEB_SESSION: 'saved' } })
    writeFileSync(path.join(dir, 'wherdr.env'), 'PORT=7696\nAPP_URL=https://m.example.ts.net/\n')
    expect(context({}, env, '/home/test')).toMatchObject({ port: '7696', env: { APP_URL: 'https://m.example.ts.net/' } })
    expect(context({}, { ...env, PORT: '7697' }, '/home/test').port).toBe('7697')
    expect(context({ port: '7698' }, { ...env, PORT: '7697' }, '/home/test').port).toBe('7698')
  })
})

describe('runtime and install location', () => {
  it('looks for node in version managers before Bun, WHERDR_RUNTIME first', () => {
    const list = runtimeCandidates({ WHERDR_RUNTIME: '/opt/node22/bin/node', PATH: '' }, '/home/test', '/usr/bin/node')
    expect(list[0]).toBe('/opt/node22/bin/node')
    expect(list).toContain('/home/test/.n/bin/node')
    expect(list).toContain('/home/test/.volta/bin/node')
    expect(list.indexOf('/opt/homebrew/bin/node')).toBeLessThan(list.indexOf('/home/test/.bun/bin/bun'))
  })

  it('tells temporary npx / pnpm dlx / bunx folders from a real install', () => {
    expect(temporaryInstall('/home/test/.npm/_npx/1a2b/node_modules/wherdr/bin/wherdr.mjs')).toBe(true)
    expect(temporaryInstall('/home/test/.cache/pnpm/dlx/abc/node_modules/wherdr/bin/wherdr.mjs')).toBe(true)
    expect(temporaryInstall('/tmp/bunx-501-wherdr@latest/node_modules/wherdr/bin/wherdr.mjs')).toBe(true)
    expect(temporaryInstall('/opt/homebrew/lib/node_modules/wherdr/bin/wherdr.mjs')).toBe(false)
    expect(temporaryInstall('/usr/local/lib/node_modules/wherdr/bin/wherdr.mjs')).toBe(false)
  })
})

describe('login service files', () => {
  const spec = { runtime: '/Users/test/.n/bin/node', args: ['/opt/w/bin/wherdr.mjs', 'run', '--port', '7683'], env: { PATH: '/Users/test/.n/bin:/usr/bin', APP_URL: 'https://a.example/?x=1&y=2' }, log: '/Users/test/wherdr/wherdr.log' }

  it('launchd: absolute runtime, escaped values, restart on crash only', () => {
    const plist = launchdPlist(spec)
    expect(plist).toContain('<key>Label</key><string>dev.wherdr</string>')
    expect(plist).toMatch(/<array>\s*<string>\/Users\/test\/\.n\/bin\/node<\/string>\s*<string>\/opt\/w\/bin\/wherdr\.mjs<\/string>\s*<string>run<\/string>/)
    expect(plist).toContain('<string>https://a.example/?x=1&amp;y=2</string>')
    expect(plist).toContain('<key>SuccessfulExit</key><false/>')
    expect(plist).toContain('<key>StandardErrorPath</key><string>/Users/test/wherdr/wherdr.log</string>')
  })

  it('systemd: quoted ExecStart and Environment, % escaped', () => {
    const unit = systemdUnit({ ...spec, env: { PATH: '/usr/bin', HOST_LABEL: 'my "pi" 100%' } })
    expect(unit).toContain('ExecStart="/Users/test/.n/bin/node" "/opt/w/bin/wherdr.mjs" "run" "--port" "7683"')
    expect(unit).toContain('Environment="HOST_LABEL=my \\"pi\\" 100%%"')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('Restart=on-failure')
  })
})

describe('port check', () => {
  it('tells a free port from one another program holds', async () => {
    const srv = http.createServer((_req, res) => { res.statusCode = 404; res.end() })
    const listening = Promise.withResolvers<void>()
    srv.listen(0, '127.0.0.1', () => listening.resolve())
    await listening.promise
    const port = (srv.address() as net.AddressInfo).port
    try {
      expect(await portTaken(port, '127.0.0.1')).toBe('other')
    } finally {
      const closed = Promise.withResolvers<void>()
      srv.close(() => closed.resolve())
      srv.closeAllConnections()
      await closed.promise
    }
    expect(await portTaken(port, '127.0.0.1')).toBeNull()
  })
})

describe('wherdr open', () => {
  const LOCAL = 'http://localhost:7683'
  const phone = { url: 'https://box.example.ts.net:7683/', served: true, httpsPort: '7683' }
  const net = (p: object | null) => async () => ({ installed: true, phone: p })

  it('opens the tailnet address when wherdr is published there and it answers', async () => {
    expect(await openAddress(LOCAL, '7683', { net: net(phone), reach: async () => 'ok' })).toBe('https://box.example.ts.net:7683')
  })

  it('lets wherdr allow a freshly published address, then opens it', async () => {
    const reaches = ['host', 'ok']
    const asked: string[] = []
    expect(await openAddress(LOCAL, '7683', { net: net(phone), reach: async () => reaches.shift(), allow: async (u: string) => { asked.push(u) } })).toBe('https://box.example.ts.net:7683')
    expect(asked).toEqual([LOCAL])
  })

  it('stays on localhost when unpublished, unanswered or without Tailscale', async () => {
    const never = async () => { throw new Error('not probed') }
    expect(await openAddress(LOCAL, '7683', { net: net({ ...phone, served: false }), reach: never })).toBe(LOCAL)
    expect(await openAddress(LOCAL, '7683', { net: net(null), reach: never })).toBe(LOCAL)
    expect(await openAddress(LOCAL, '7683', { net: async () => ({ installed: false }), reach: never })).toBe(LOCAL)
    expect(await openAddress(LOCAL, '7683', { net: net(phone), reach: async () => 'unreachable' })).toBe(LOCAL)
    expect(await openAddress(LOCAL, '7683', { net: net(phone), reach: async () => 'host', allow: async () => {} })).toBe(LOCAL)
  })
})
