import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const script = readFileSync(new URL('../website/public/install', import.meta.url), 'utf8')
const startup = script.slice(script.indexOf('service_startup() {'), script.indexOf('\n# Installs through the plugin'))

function run(os: string, linger = 'yes', status = 0) {
  return execFileSync('sh', ['-c', `
    say() { printf '%s\\n' "$*"; }
    service_file() { printf '/example/service'; }
    id() { printf 'example'; }
    loginctl() {
      [ "$*" = 'show-user example --property=Linger --value' ] || exit 2
      printf '%s' "$TEST_LINGER"
      return "$TEST_STATUS"
    }
    ${startup}
    service_startup
  `], { encoding: 'utf8', env: { OS: os, TEST_LINGER: linger, TEST_STATUS: String(status) } })
}

describe('installer startup policy', () => {
  it('reports login startup on macOS without consulting lingering', () => {
    const out = run('Darwin', 'yes', 1)
    expect(out).toContain('LaunchAgent')
    expect(out).toContain('starts at login')
    expect(out).not.toContain('boot')
    expect(out).not.toContain('lingering')
  })

  it('reports boot startup and persistence after logout with lingering', () => {
    expect(run('Linux')).toContain('Lingering is enabled: wherdr starts at boot and keeps running after you log out.')
  })

  it('reports login startup and stopping after logout without lingering', () => {
    const out = run('Linux', 'no')
    expect(out).toContain('Lingering is disabled: wherdr starts at login and stops after you log out.')
    expect(out).not.toContain('starts at boot')
  })

  it.each([['yes', 1], ['', 127], ['', 0], ['unexpected', 0]])('does not promise boot startup for an unverified result (%s, %s)', (value, status) => {
    const out = run('Linux', value, status)
    expect(out).toContain('Could not check lingering')
    expect(out).toContain('loginctl show-user $(id -un) --property=Linger --value')
    expect(out).not.toContain('starts at boot')
  })
})
