// The "wherdr" agent skill (skills/wherdr/SKILL.md) must quote the exact
// messages of the Project panel and the list names it recognizes, and the
// plugin must link it into the agents' skill folders without touching
// anything it does not own.
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  decisionPrefix, detailPrefix, launchMessage, listKind, moveMessage, problemPrefix, questionPrefix,
  reviewCommentPrefix, reviewedMessage, testedMessage, unblockMessage, type ListKind, type MoveAction, type TestLang,
} from '../shared/projectBoard'

const REPO = path.resolve(import.meta.dirname, '..')
const skill = readFileSync(path.join(REPO, 'skills', 'wherdr', 'SKILL.md'), 'utf8')

describe('wherdr skill', () => {
  it('has the agent skill front matter', () => {
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? ''
    expect(fm).toMatch(/^name: wherdr$/m)
    expect(fm).toMatch(/^description: \S/m)
  })

  it('quotes every panel message as the panel writes it, in both languages', () => {
    const moves: MoveAction[] = ['up', 'down', 'queue', 'now', 'unqueue', 'backlog']
    const builders: ((task: string, lang: TestLang) => string)[] = [
      testedMessage, problemPrefix, questionPrefix, decisionPrefix, launchMessage, detailPrefix,
      reviewedMessage, reviewCommentPrefix, unblockMessage, ...moves.map(a => (task: string, lang: TestLang) => moveMessage(a, task, lang)),
    ]
    for (const build of builders) {
      for (const lang of ['en', 'fr'] as const) {
        const msg = build('<task>', lang).trimEnd()
        expect(skill, msg).toContain(msg)
        // The description lists the message starts, so the skill loads on them.
        const description = /^description: (.*)$/m.exec(skill)![1]!
        const starts = [...description.matchAll(/"([^"]+)"/g)].map(m => m[1]!)
        expect(starts.some(s => msg.startsWith(s)), msg).toBe(true)
      }
    }
  })

  it('lists only titles the panel maps to that list', () => {
    const kinds: Record<string, ListKind> = {
      'To test': 'test', 'To decide': 'decide', 'To review': 'review', 'In progress': 'doing', 'In queue': 'queue',
      'Blocked': 'blocked', 'To do': 'todo', 'Backlog': 'backlog', 'Done': 'done',
    }
    const rows = skill.split('\n').filter(l => /^\| [A-Z]/.test(l) && !l.startsWith('| List') && !l.startsWith('| Message'))
    const seen = new Set<string>()
    for (const row of rows) {
      const [name, titles] = row.split('|').slice(1, 3).map(c => c.trim()) as [string, string]
      const kind = kinds[name]
      if (!kind) continue
      seen.add(name)
      expect(listKind(name), name).toBe(kind)
      for (const title of titles.split(', ')) {
        // "Bloqué(e)(s)": the bare and the full form.
        for (const form of [title.replace(/\([^)]*\)/g, ''), title.replace(/[()]/g, '')]) expect(listKind(form), form).toBe(kind)
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(kinds).sort())
  })
})

describe.skipIf(process.platform === 'win32')('herdr plugin skill install', () => {
  let tmp: string, home: string, dir: string
  const run = (...args: string[]) => spawnSync('sh', [path.join(REPO, 'scripts', 'herdr-plugin.sh'), 'skill', ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, WHERDR_DIR: dir },
  })
  const claudeLink = () => path.join(home, '.claude', 'skills', 'wherdr')
  const agentsLink = () => path.join(home, '.agents', 'skills', 'wherdr')
  const copy = () => path.join(dir, 'skills', 'wherdr')

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'wherdr-skill-'))
    home = path.join(tmp, 'home'); dir = path.join(tmp, 'wherdr')
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    mkdirSync(path.join(home, '.omp'), { recursive: true })
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('links a stable copy into the Claude and shared agent skill folders, idempotently', () => {
    for (let i = 0; i < 2; i++) expect(run('install').status).toBe(0)
    for (const link of [claudeLink(), agentsLink()]) {
      expect(readlinkSync(link)).toBe(copy())
      expect(readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe(skill)
    }
  })

  it('skips harnesses that are not installed', () => {
    rmSync(path.join(home, '.omp'), { recursive: true })
    expect(run('install').status).toBe(0)
    expect(existsSync(claudeLink())).toBe(true)
    expect(existsSync(path.join(home, '.agents'))).toBe(false)
  })

  it('leaves a foreign wherdr skill alone, on install and uninstall', () => {
    const foreign = path.join(tmp, 'other')
    mkdirSync(foreign)
    mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true })
    symlinkSync(foreign, claudeLink())
    expect(run('install').status).toBe(0)
    expect(readlinkSync(claudeLink())).toBe(foreign)
    expect(readlinkSync(agentsLink())).toBe(copy())
    expect(run('uninstall').status).toBe(0)
    expect(readlinkSync(claudeLink())).toBe(foreign)
    expect(() => lstatSync(agentsLink())).toThrow()
    expect(existsSync(copy())).toBe(false)
  })
})
