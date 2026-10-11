import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INSTALL_OUTPUT } from '../website/app/utils/installDemo'

const script = readFileSync(new URL('../website/public/install', import.meta.url), 'utf8')
const summary = script.slice(script.indexOf('  ADDRESS="$(plugin_address)"'), script.indexOf('\n# The address the plugin opens:'))

function run(options: { address?: string, key?: string, browser?: string, first?: string, container?: string } = {}) {
  return execFileSync('sh', ['-c', `
    say() { printf '%s\\n' "$*"; }
    panel_key() { printf '%s' "$PANEL_KEY"; }
    plugin_address() { printf '%s' "$TEST_ADDRESS"; }
    phone_steps() { say 'Phone steps'; }
    docker_phone() { say 'Docker phone steps'; }
    id() { printf 'user'; }
    hostname() { printf 'server'; }
    summary() { ${summary}
    summary
  `], { encoding: 'utf8', env: {
    URL: 'http://localhost:7683', PORT: '7683', TEST_ADDRESS: options.address || 'http://localhost:7683',
    PANEL_KEY: options.key ?? 'prefix+i', PLUGIN_ID: 'example.wherdr', REPO: 'example/wherdr',
    BROWSER: options.browser ?? '1', FIRST: options.first ?? '1', CONTAINER: options.container ?? '0',
  } }).trim().split('\n')
}

describe('installer final summary', () => {
  it('replays the same desktop summary on the site, in running / local / Herdr / phone order', () => {
    const lines = run()
    expect(lines.slice(0, 5)).toEqual(INSTALL_OUTPUT.slice(INSTALL_OUTPUT.findIndex(l => l.kind === 'strong'), -3).map(l => l.text))
    expect(lines[0]).toBe('✓ wherdr is running')
    expect(lines.filter(l => l.includes('prefix+i'))).toHaveLength(1)
    expect(lines.filter(l => l.includes('localhost:7683'))).toHaveLength(1)
  })

  it('keeps the local address first when a private phone address exists', () => {
    const lines = run({ address: 'https://box.example.ts.net:7683' })
    expect(lines[1]).toContain('http://localhost:7683')
    expect(lines[2]).toContain('prefix+i')
    expect(lines[3]).toContain('On your phone: https://box.example.ts.net:7683')
    expect(lines[4]).toContain('a passkey is tied to its address')
  })

  it('prints the invocation fallback and phone settings on an update', () => {
    const lines = run({ key: '', first: '0' })
    expect(lines[2]).toBe('  In Herdr: herdr plugin action invoke panel --plugin example.wherdr')
    expect(lines[3]).toContain('Phone: open Settings › Phone')
  })

  it.each(['0', '1'])('keeps headless tunnel and phone actions after the Herdr key (container %s)', (container) => {
    const lines = run({ browser: '0', container })
    expect(lines[2]).toContain('prefix+i')
    expect(lines[4]).toContain('ssh -L 7683:127.0.0.1:7683 user@server')
    expect(lines[5]).toBe(container === '1' ? 'Docker phone steps' : 'Phone steps')
  })
})
