// `scripts/herdr-plugin.sh key`: the Herdr key that opens the wherdr panel,
// appended to Herdr's config.toml on a free key, never touching the user's
// own lines, and removed again by `key uninstall`.
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'herdr-plugin.sh')

describe.skipIf(process.platform === 'win32')('herdr plugin key', () => {
  let home = ''
  let config = ''
  let herdr = ''

  beforeEach(() => {
    home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-key-'))
    config = path.join(home, 'herdr', 'config.toml')
    // A Herdr that cannot print its defaults nor reload: the built-in
    // default keymap is used, and the config is not validated.
    herdr = path.join(home, 'herdr-bin')
    writeFileSync(herdr, '#!/bin/sh\nexit 1\n')
    chmodSync(herdr, 0o755)
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  const run = (sub: string, env: Record<string, string> = {}) => spawnSync('sh', [SCRIPT, 'key', sub], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, WHERDR_DIR: path.join(home, 'wherdr'), HERDR_CONFIG_PATH: config, HERDR_BIN_PATH: herdr, ...env },
  })
  const write = (text: string) => { mkdirSync(path.dirname(config), { recursive: true }); writeFileSync(config, text) }
  const read = () => readFileSync(config, 'utf8')
  const boundKeys = (text: string) => [...text.matchAll(/^key = "([^"]*)"\ntype = "plugin_action"\ncommand = "afloury\.wherdr\.panel"$/gm)].map(m => m[1])

  it('appends one marked block after the existing config, kept byte for byte, and only once', () => {
    const mine = '# my setup\n[keys]\nprefix = "ctrl+a"   # tmux habit\n\n[[keys.command]]\nkey = "prefix+alt+g"\ntype = "popup"\ncommand = "lazygit"\n'
    write(mine)
    const first = run('install')
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('Press prefix+i in Herdr to open the wherdr panel.')
    const after = read()
    expect(after.startsWith(mine)).toBe(true)
    expect(boundKeys(after)).toEqual(['prefix+i'])
    expect(run('install').stdout).toContain('Press prefix+i in Herdr to open the wherdr panel.')
    expect(read()).toBe(after)
  })

  it('creates the config when Herdr runs without one', () => {
    expect(run('install').status).toBe(0)
    expect(boundKeys(read())).toEqual(['prefix+i'])
  })

  it('skips keys bound by Herdr defaults, the user keymap or other commands', () => {
    write('[keys]\nsettings = ["prefix+i", "ctrl+alt+s"]\n\n[[keys.command]]\nkey = "prefix+u"\ntype = "shell"\ncommand = "true"\n')
    // prefix+o: open_notification_target; prefix+W is prefix+shift+w (rename_workspace).
    run('install', { WHERDR_HOTKEYS: 'prefix+o prefix+W prefix+i prefix+u prefix+y' })
    expect(boundKeys(read())).toEqual(['prefix+y'])
  })

  it('takes a default key the user rebound elsewhere', () => {
    write('[keys]\nopen_notification_target = "prefix+f"\n')
    run('install', { WHERDR_HOTKEYS: 'prefix+f prefix+o' })
    expect(boundKeys(read())).toEqual(['prefix+o'])
  })

  it('adds nothing when every candidate is taken', () => {
    const mine = '[keys]\nsettings = "prefix+i"\n'
    write(mine)
    const r = run('install', { WHERDR_HOTKEYS: 'prefix+i prefix+w' })
    expect(r.status).toBe(0)
    expect(r.stderr).toContain('no Herdr key added')
    expect(read()).toBe(mine)
  })

  it('keeps a key the user already bound to the panel', () => {
    const mine = '[[keys.command]]\nkey = "prefix+alt+p"\ntype = "plugin_action"\ncommand = "afloury.wherdr.panel"\n'
    write(mine)
    expect(run('install').stdout).toContain('Press prefix+alt+p in Herdr to open the wherdr panel.')
    expect(read()).toBe(mine)
    expect(run('status').stdout.trim()).toBe('prefix+alt+p')
  })

  it('flags a key bound to the former action id without changing it', () => {
    const mine = '[[keys.command]]\nkey = "prefix+alt+p"\ntype = "plugin_action"\ncommand = "afloury.wherdr.wherdr"\n'
    write(mine)
    const r = run('install')
    expect(r.stderr).toContain('prefix+alt+p runs afloury.wherdr.wherdr, renamed afloury.wherdr.panel')
    expect(read().startsWith(mine)).toBe(true)
    expect(boundKeys(read())).toEqual(['prefix+i'])
  })

  it('uninstall removes only its block and gives the original file back', () => {
    const mine = '# my setup\n[keys]\nprefix = "ctrl+a"\n\n\n[[keys.command]]\nkey = "prefix+alt+g"\ntype = "popup"\ncommand = "lazygit"\n'
    write(mine)
    run('install')
    expect(run('uninstall').status).toBe(0)
    expect(read()).toBe(mine)
    expect(run('status').stdout.trim()).toBe('none')
    expect(run('uninstall').stdout).toContain('no wherdr key')
    expect(existsSync(`${config}.wherdr-tmp`)).toBe(false)
  })
})
