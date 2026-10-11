import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

it('sets the authenticated GitHub identity only in the temporary tap clone', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-brew-'))
  try {
    const bin = path.join(home, 'bin')
    mkdirSync(bin)
    const executable = (name: string, text: string) => writeFileSync(path.join(bin, name), `#!/bin/sh\nset -eu\n${text}\n`, { mode: 0o755 })
    executable('gh', `case "$*" in
      'api user --jq .login') echo contributor ;;
      'api user --jq .id') echo 1234 ;;
      'api user --jq .name // .login') echo 'Test Contributor' ;;
      repo\\ clone*) mkdir -p "$4/Formula"; printf '  url "old"\\n  sha256 "old"\\n' > "$4/Formula/wherdr.rb" ;;
      *) exit 1 ;;
    esac`)
    executable('curl', `case "$2" in *.sha256) printf '%s  wherdr.tgz\\n' '${createHash('sha256').update('archive').digest('hex')}' > "$4" ;; *) printf archive > "$4" ;; esac`)
    executable('git', `printf '%s\\n' "$*" >> "$HOME/git-calls"
      case "$*" in 'diff --quiet') exit 1 ;; esac`)
    execFileSync('sh', ['scripts/bump-homebrew.sh', '1.2.3', 'example'], {
      env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` }, stdio: 'pipe',
    })
    const calls = readFileSync(path.join(home, 'git-calls'), 'utf8')
    expect(calls).toContain('config --local user.name Test Contributor\n')
    expect(calls).toContain('config --local user.email 1234+contributor@users.noreply.github.com\n')
    expect(calls).not.toContain('--global')
    expect(calls.indexOf('config --local user.email')).toBeLessThan(calls.indexOf('commit -qam'))
  } finally { rmSync(home, { recursive: true, force: true }) }
})
