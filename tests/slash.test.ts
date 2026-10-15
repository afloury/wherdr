import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeProjectDirs, frontmatter, mergeCommands, ompSkillDirs, slashCommands as slashResult } from '../server/utils/slash'
import { type MachineFs, type ShellExec, localFs } from '../server/utils/fsx'

const slashCommands = async (o: Parameters<typeof slashResult>[0]) => (await slashResult(o)).commands

// A machine reached over SSH: the script run by a local `sh`.
const shExec: ShellExec = async (script, args = []) => {
  const r = spawnSync('sh', ['-c', script, 'sh', ...args])
  return { code: r.status, stdout: r.stdout, stderr: r.stderr.toString() }
}
const refused = { code: 255, stdout: Buffer.alloc(0), stderr: 'Connection closed by UNKNOWN port 65535' }

describe('"/" commands', () => {
  it('lit le frontmatter', () => {
    expect(frontmatter('---\nname: pdf\ndescription: "Lire des PDF"\nuser-invocable: false\n---\ncorps')).toEqual({ name: 'pdf', description: 'Lire des PDF', 'user-invocable': 'false' })
    expect(frontmatter('pas de frontmatter')).toEqual({})
  })

  it('merges, personal ones hiding built-in ones, sorted', () => {
    const r = mergeCommands([['model', 'intégrée'], ['clear', 'x']], [{ name: 'model', desc: 'perso', source: 'command' }])
    expect(r.map(c => [c.name, c.desc])).toEqual([['clear', 'x'], ['model', 'perso']])
  })

  it('finds skills (including synced ones), commands and Codex prompts', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-'))
    const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
    w('.claude/skills/mine/SKILL.md', '---\nname: mine\ndescription: Mon skill\n---\n')
    w('.claude/skills/synced/acct/pdf/SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n')
    w('.claude/skills/hidden/SKILL.md', '---\nname: hidden\nuser-invocable: false\n---\n')
    w('.claude/commands/deploy.md', '# Déployer le site\n')
    w('.claude/commands/git/sync.md', '---\ndescription: Synchroniser\nargument-hint: <branche>\n---\n')
    w('proj/.claude/commands/local.md', 'Commande du projet\n')
    w('.codex/prompts/fix.md', '---\ndescription: Corriger\n---\n')
    const cl = await slashCommands({ key: 't1', fs: localFs, home, kind: 'claude', cwd: path.join(home, 'proj') })
    const names = cl.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['mine', 'pdf', 'deploy', 'git:sync', 'local', 'model', 'resume']))
    expect(names).not.toContain('hidden')
    expect(cl.find(c => c.name === 'git:sync')).toMatchObject({ desc: 'Synchroniser', hint: '<branche>' })
    expect(cl.find(c => c.name === 'deploy')!.desc).toBe('Déployer le site')
    const cx = await slashCommands({ key: 't1', fs: localFs, home, kind: 'codex', cwd: null })
    expect(cx.map(c => c.name)).toEqual(expect.arrayContaining(['prompts:fix', 'new', 'model']))
  })

  it('SSH machine: project and user skills, commands and symlinked skills in one session', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-ssh-'))
    const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
    w('proj/.claude/skills/daily-notes/SKILL.md', '---\nname: daily-notes\ndescription: Daily notes\n---\n')
    w('proj/.claude/commands/local.md', 'Project command\n')
    w('.claude/skills/synced/acct/pdf/SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n')
    w('.claude/skills/hidden/SKILL.md', '---\nname: hidden\nuser-invocable: false\n---\n')
    w('.claude/commands/git/sync.md', '---\ndescription: Sync\nargument-hint: <branch>\n---\n')
    w('.claude/commands/a/b/c/too-deep.md', 'x\n')
    w('shared/tidy/SKILL.md', '---\ndescription: Tidy up\n---\n')
    symlinkSync(path.join(home, 'shared/tidy'), path.join(home, '.claude/skills/tidy'))
    let calls = 0
    const exec: ShellExec = (s, a, o) => { calls++; return shExec(s, a, o) }
    const cl = await slashCommands({ key: 'ssh1', fs: localFs, exec, home, kind: 'claude', cwd: path.join(home, 'proj') })
    const names = cl.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['daily-notes', 'local', 'pdf', 'git:sync', 'tidy', 'model']))
    expect(names).not.toContain('hidden')
    expect(names.some(n => n.includes('too-deep'))).toBe(false)
    expect(cl.find(c => c.name === 'git:sync')).toMatchObject({ desc: 'Sync', hint: '<branch>', source: 'command' })
    expect(cl.find(c => c.name === 'local')!.desc).toBe('Project command')
    expect(calls).toBe(1)
  })

  it('SSH machine: a refused session is retried once; two refusals throw and are not cached', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-retry-'))
    mkdirSync(path.join(home, '.claude/skills/notes'), { recursive: true })
    writeFileSync(path.join(home, '.claude/skills/notes/SKILL.md'), '---\nname: notes\n---\n')
    let fails = 1
    const flaky: ShellExec = (s, a, o) => (fails-- > 0 ? Promise.resolve(refused) : shExec(s, a, o))
    const once = await slashCommands({ key: 'ssh2', fs: localFs, exec: flaky, home, kind: 'claude', cwd: null })
    expect(once.map(c => c.name)).toContain('notes')

    fails = 2
    await expect(slashCommands({ key: 'ssh3', fs: localFs, exec: flaky, home, kind: 'claude', cwd: null })).rejects.toThrow('Connection closed')
    const later = await slashCommands({ key: 'ssh3', fs: localFs, exec: flaky, home, kind: 'claude', cwd: null })
    expect(later.map(c => c.name)).toContain('notes')
  })

  it('SSH machine: omp reads its config then the custom skill folders', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-omp-ssh-'))
    const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
    w('.omp/agent/commands/review.md', '---\ndescription: Review\n---\n')
    w('extra-skills/tidy/SKILL.md', '---\nname: tidy\n---\n')
    w('.omp/agent/config.yml', 'skills:\n  customDirectories:\n    - ~/extra-skills\n')
    const names = (await slashCommands({ key: 'ssh4', fs: localFs, exec: shExec, home, kind: 'omp', cwd: null })).map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['review', 'init', 'skill:tidy', 'model']))
  })

  it('omp: built-in, commands (omp, project, Claude) and skills as /skill:<name>, config folders included', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-omp-'))
    const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
    w('.omp/agent/commands/review.md', '---\ndescription: Relire\n---\n')
    w('.claude/commands/deploy.md', '# Déployer\n')
    w('proj/.omp/commands/local.md', 'Commande du projet\n')
    w('.agents/skills/pdf/SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n')
    w('extra-skills/tidy/SKILL.md', '---\nname: tidy\ndescription: Ranger\n---\n')
    w('.omp/agent/config.yml', 'theme: dark\nskills:\n  enabled: true\n  customDirectories:\n    - ~/extra-skills\n  other: x\nextensions:\n  - ~/nope\n')
    const names = (await slashCommands({ key: 't1', fs: localFs, home, kind: 'omp', cwd: path.join(home, 'proj') })).map(c => c.name)
    expect(names).toEqual(expect.arrayContaining(['review', 'deploy', 'local', 'init', 'skill:pdf', 'skill:tidy', 'session', 'compact', 'model']))
    expect(names).not.toContain('pdf')
  })

  it('reads skills.customDirectories in omp\'s YAML config', () => {
    const cfg = 'skills:\n  customDirectories:\n    - ~/a\n    - "/abs/b"\n    - rel\n  enableSkillCommands: true\nother:\n  customDirectories:\n    - ~/no\n'
    expect(ompSkillDirs(cfg, '/h')).toEqual(['/h/a', '/abs/b', '/h/rel'])
    expect(ompSkillDirs('theme: x\n', '/h')).toEqual([])
  })

  it('Claude: project folders are the pane folder and its parents, up to the home folder', () => {
    expect(claudeProjectDirs('/h/vault/notes/day', '/h')).toEqual(['/h/vault/notes/day', '/h/vault/notes', '/h/vault'])
    expect(claudeProjectDirs('/h', '/h')).toEqual([])
    expect(claudeProjectDirs('/h/', '/h')).toEqual([])
    expect(claudeProjectDirs(null, '/h')).toEqual([])
    expect(claudeProjectDirs('/srv/app', '/h')).toEqual(['/srv/app', '/srv', '/'])
  })

  // As Claude Code: a pane in a subfolder still offers the commands of the
  // project's .claude/ above it, but nothing above the Git root.
  for (const ssh of [false, true]) {
    it(`Claude${ssh ? ', SSH machine' : ''}: reads the .claude/ of parent folders, stopping at the Git root`, async () => {
      const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-up-'))
      const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
      w('notes/.claude/commands/journal.md', '---\ndescription: Journal\n---\n')
      w('notes/.claude/skills/weekly/SKILL.md', '---\nname: weekly\ndescription: Weekly review\n---\n')
      w('notes/inbox/today/.keep', '')
      w('work/.claude/commands/outside.md', 'Above the repository\n')
      w('work/app/.git/HEAD', 'ref: refs/heads/main\n')
      w('work/app/.claude/skills/ship/SKILL.md', '---\nname: ship\n---\n')
      w('work/app/src/.claude/commands/near.md', 'Nearest\n')
      w('.claude/commands/mine.md', 'Mine\n')
      const exec = ssh ? shExec : null
      const key = `up-${ssh}`
      const sub = (await slashCommands({ key, fs: localFs, exec, home, kind: 'claude', cwd: path.join(home, 'notes/inbox/today') })).map(c => c.name)
      expect(sub).toEqual(expect.arrayContaining(['journal', 'weekly', 'mine']))
      const repo = (await slashCommands({ key, fs: localFs, exec, home, kind: 'claude', cwd: path.join(home, 'work/app/src') })).map(c => c.name)
      expect(repo).toEqual(expect.arrayContaining(['near', 'ship', 'mine']))
      expect(repo).not.toContain('outside')
      const atHome = (await slashCommands({ key, fs: localFs, exec, home, kind: 'claude', cwd: home })).filter(c => c.source !== 'builtin').map(c => c.name)
      expect(atHome).toEqual(['mine'])
    })
  }

  it('SSH machine on macOS: a project folder macOS refuses to list is reported, not taken for "no commands"', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-tcc-'))
    const w = (f: string, t: string) => { mkdirSync(path.dirname(path.join(home, f)), { recursive: true }); writeFileSync(path.join(home, f), t) }
    w('Documents/vault/.claude/commands/journal.md', 'Journal\n')
    w('.claude/commands/mine.md', 'Mine\n')
    // A Mac without full disk access for SSH: `ls` is refused under Documents.
    const bin = path.join(home, 'bin')
    mkdirSync(bin)
    writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\necho Darwin\n')
    writeFileSync(path.join(bin, 'ls'), `#!/bin/sh\nfor a; do case $a in */Documents/*) echo "ls: $a: Operation not permitted" >&2; exit 1 ;; esac; done\nexec /bin/ls "$@"\n`)
    chmodSync(path.join(bin, 'uname'), 0o755)
    chmodSync(path.join(bin, 'ls'), 0o755)
    chmodSync(path.join(home, 'Documents/vault/.claude/commands'), 0o000)
    const mac: ShellExec = async (script, args = []) => {
      const r = spawnSync('sh', ['-c', script, 'sh', ...args], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
      return { code: r.status, stdout: r.stdout, stderr: r.stderr.toString() }
    }
    try {
      const r = await slashResult({ key: 'tcc1', fs: localFs, exec: mac, home, kind: 'claude', cwd: path.join(home, 'Documents/vault') })
      expect(r.denied).toBe('macos')
      expect(r.commands.map(c => c.name)).toContain('mine')
      // Same refusal on Linux: plain permissions, nothing to explain.
      const linux = await slashResult({ key: 'tcc2', fs: localFs, exec: shExec, home, kind: 'claude', cwd: path.join(home, 'Documents/vault') })
      expect(linux.denied).toBeUndefined()
    } finally {
      chmodSync(path.join(home, 'Documents/vault/.claude/commands'), 0o755)
    }
  })

  it('local disk on macOS: EPERM on a project folder is reported', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hw-slash-tcc-local-'))
    mkdirSync(path.join(home, '.claude/commands'), { recursive: true })
    writeFileSync(path.join(home, '.claude/commands/mine.md'), 'Mine\n')
    const vault = path.join(home, 'Documents/vault')
    const eperm = () => Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
    const fs: MachineFs = { ...localFs, readdir: p => (p.startsWith(vault) ? Promise.reject(eperm()) : localFs.readdir(p)) }
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const r = await slashResult({ key: 'tcc3', fs, home, kind: 'claude', cwd: vault })
      expect(r.denied).toBe('macos')
      expect(r.commands.map(c => c.name)).toContain('mine')
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })
})
