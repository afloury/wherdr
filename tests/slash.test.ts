import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { frontmatter, mergeCommands, ompSkillDirs, slashCommands } from '../server/utils/slash'
import { localFs } from '../server/utils/fsx'

describe('commandes « / »', () => {
  it('lit le frontmatter', () => {
    expect(frontmatter('---\nname: pdf\ndescription: "Lire des PDF"\nuser-invocable: false\n---\ncorps')).toEqual({ name: 'pdf', description: 'Lire des PDF', 'user-invocable': 'false' })
    expect(frontmatter('pas de frontmatter')).toEqual({})
  })

  it('fusionne, les personnelles masquant les intégrées, triées', () => {
    const r = mergeCommands([['model', 'intégrée'], ['clear', 'x']], [{ name: 'model', desc: 'perso', source: 'command' }])
    expect(r.map(c => [c.name, c.desc])).toEqual([['clear', 'x'], ['model', 'perso']])
  })

  it('trouve skills (y compris synchronisés), commandes et invites Codex', async () => {
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

  it('omp : intégrées, commandes (omp, projet, Claude) et skills en /skill:<nom>, dossiers de la config compris', async () => {
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

  it('lit skills.customDirectories dans la config YAML d’omp', () => {
    const cfg = 'skills:\n  customDirectories:\n    - ~/a\n    - "/abs/b"\n    - rel\n  enableSkillCommands: true\nother:\n  customDirectories:\n    - ~/no\n'
    expect(ompSkillDirs(cfg, '/h')).toEqual(['/h/a', '/abs/b', '/h/rel'])
    expect(ompSkillDirs('theme: x\n', '/h')).toEqual([])
  })
})
