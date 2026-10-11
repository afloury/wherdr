import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
for (const job of ['package', 'publish-release']) {
  it(`${job} refuses missing drafts/notes and never generates release notes`, () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'wherdr-draft-'))
    try {
      const bin = path.join(home, 'bin')
      mkdirSync(bin)
      writeFileSync(path.join(home, 'wherdr-1.3.3.tgz'), 'archive')
      writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
case "$*" in
  'release view '*)
    [ "$DRAFT_EXISTS" = 1 ] || exit 1
    case "$*" in
      *'--json isDraft'*) echo "$IS_DRAFT" ;;
      *'--json body'*) printf '%s' "$DRAFT_NOTES" | tr -d '[:space:]' ;;
    esac ;;
  *) printf '%s\\n' "$*" >> "$HOME/mutations" ;;
esac
`, { mode: 0o755 })
      const name = job === 'package' ? 'Attach package to draft' : 'Publish without advancing the legacy update channel'
      const section = workflow.split(`      - name: ${name}\n`)[1]!
      const script = section.split('        run: |\n')[1]!.split('\n\n')[0]!
        .split('\n').map(line => line.replace(/^          /, '')).join('\n')
      for (const scenario of [
        { exists: '0', draft: 'true', notes: 'Reviewed notes', ok: false },
        { exists: '1', draft: 'false', notes: 'Reviewed notes', ok: false },
        { exists: '1', draft: 'true', notes: '', ok: false },
        { exists: '1', draft: 'true', notes: ' \n\t ', ok: false },
        { exists: '1', draft: 'true', notes: '## Fixed\nReviewed changes', ok: true },
      ]) {
        rmSync(path.join(home, 'mutations'), { force: true })
        const run = spawnSync('sh', ['-e', '-c', script], { cwd: home, encoding: 'utf8', env: {
          ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, GITHUB_REF_NAME: 'v1.3.3',
          GITHUB_REPOSITORY: 'example/wherdr', DRAFT_EXISTS: scenario.exists,
          IS_DRAFT: scenario.draft, DRAFT_NOTES: scenario.notes,
        } })
        expect(run.status === 0, run.stderr).toBe(scenario.ok)
        let mutations = ''
        try { mutations = readFileSync(path.join(home, 'mutations'), 'utf8') } catch {}
        if (!scenario.ok) expect(mutations).toBe('')
        else expect(mutations).toContain(job === 'package' ? 'release upload' : 'release edit')
        expect(mutations).not.toMatch(/release create|generate-notes/)
      }
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
}
