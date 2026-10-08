import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { brewDoctor, brewPaths, brewRedirect, brewService, brewStatusRows, parseLaunchctl, parseServiceInfo } from '../bin/lib/brew.mjs'

const CELLAR_BIN = '/opt/homebrew/Cellar/wherdr/1.3.1/libexec/lib/node_modules/wherdr/bin/wherdr.mjs'
const running = { prefix: '/opt/homebrew', brew: '/opt/homebrew/bin/brew', log: '/opt/homebrew/var/log/wherdr.log', loaded: true, running: true }
const stopped = { ...running, loaded: false, running: false }

describe('Homebrew install', () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  it('finds the prefix, brew and the service log from the Cellar path', () => {
    expect(brewPaths(CELLAR_BIN)).toEqual({ prefix: '/opt/homebrew', brew: '/opt/homebrew/bin/brew', log: '/opt/homebrew/var/log/wherdr.log' })
    expect(brewPaths('/usr/local/lib/node_modules/wherdr/bin/wherdr.mjs')).toBeNull()
  })

  it('reads the service state from brew services info and launchctl', () => {
    expect(parseServiceInfo('[{"name":"wherdr","service_name":"sh.brew.wherdr","running":true,"loaded":true,"status":"started"}]')).toEqual({ loaded: true, running: true })
    expect(parseServiceInfo('[{"name":"wherdr","running":false,"loaded":false,"status":"none"}]')).toEqual({ loaded: false, running: false })
    expect(parseServiceInfo('[{"name":"other","running":true}]')).toBeNull()
    expect(parseServiceInfo('Error: not JSON')).toBeNull()
    expect(parseLaunchctl('gui/501/sh.brew.wherdr = {\n\tstate = running\n\tpid = 42\n}')).toBe(true)
    expect(parseLaunchctl('gui/501/sh.brew.wherdr = {\n\tstate = not running\n}')).toBe(false)
  })

  it('asks the brew of the install prefix', () => {
    const prefix = mkdtempSync(path.join(os.tmpdir(), 'wherdr-brew-'))
    dirs.push(prefix)
    mkdirSync(path.join(prefix, 'bin'))
    writeFileSync(path.join(prefix, 'bin', 'brew'), '#!/bin/sh\n[ "$*" = "services info wherdr --json" ] && echo \'[{"name":"wherdr","loaded":true,"running":true}]\'\n')
    chmodSync(path.join(prefix, 'bin', 'brew'), 0o755)
    const svc = brewService(path.join(prefix, 'Cellar/wherdr/1.3.1/libexec/lib/node_modules/wherdr/bin/wherdr.mjs'), prefix)
    expect(svc).toMatchObject({ prefix, log: path.join(prefix, 'var/log/wherdr.log'), loaded: true, running: true })
    expect(brewService('/usr/local/lib/node_modules/wherdr/bin/wherdr.mjs')).toBeNull()
  })

  it('status shows the Homebrew service, not "started another way"', () => {
    expect(brewStatusRows(running)).toMatchObject({ process: 'Homebrew service (brew services)', service: 'Homebrew (brew services) · running', log: '/opt/homebrew/var/log/wherdr.log' })
    expect(brewStatusRows(stopped).process).toBeNull()
    expect(brewStatusRows(stopped).service).toContain('brew services start wherdr')
    expect(brewStatusRows({ ...running, running: false }).service).toContain('started but not running')
  })

  it('doctor is happy with a running Homebrew service and never suggests wherdr service install', () => {
    expect(brewDoctor(running)[0]).toBe('ok')
    expect(brewDoctor({ ...running, running: false })[0]).toBe('fail')
    expect(brewDoctor(stopped)).toEqual(['warn', expect.stringContaining('brew services start wherdr')])
    for (const s of [running, stopped]) expect(brewDoctor(s)[1]).not.toContain('wherdr service install')
  })

  it('points start, stop, restart and service install to brew services', () => {
    expect(brewRedirect('stop', running)).toContain('brew services stop wherdr')
    expect(brewRedirect('stop', stopped)).toBeNull()
    expect(brewRedirect('restart', running)).toContain('brew services restart wherdr')
    expect(brewRedirect('start', stopped)).toContain('brew services start wherdr')
    expect(brewRedirect('start', running)).toBeNull()
    expect(brewRedirect('service', stopped)).toContain('brew services start wherdr')
    expect(brewRedirect('stop', null)).toBeNull()
  })
})
