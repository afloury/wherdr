import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INSTALL_OUTPUT } from '../website/app/utils/installDemo'
import { listGroups, projectSummary, scriptProblems } from '../website/app/utils/demoScript'
import type { DemoAgent, DemoScript } from '../website/app/utils/demoScript'
import { ANSWER, HERO, SHOP, actionsAt, agentState } from '../website/app/utils/heroDemo'
import { CATCHUP_MS, GLYPH_MS as SITE_GLYPH_MS, TRAIL_GLYPHS as SITE_TRAIL, trailGlyphs as siteGlyphs, typeDuration, typingFronts as siteFronts } from '../website/app/utils/typing'
import { GLYPH_MS as APP_GLYPH_MS, TRAIL_GLYPHS as APP_TRAIL, trailGlyphs as appGlyphs, typingFronts as appFronts } from '../app/utils/typewriter'
import { BOARD, BOARD_GROUPS, CONVERSATION, COUPONS, PHONE, boardAt } from '../website/app/utils/storyDemos'

describe('install demo', () => {
  // Every step / ok line the site replays must be one the real script prints,
  // with the shell variables filled in.
  const script = readFileSync(new URL('../website/public/install', import.meta.url), 'utf8')
  const templates = [...script.matchAll(/(?:^|\s)(step|ok) "((?:[^"\\]|\\.)*)"/gm)].map(([, kind, text]) => ({
    kind,
    re: new RegExp(`^${text!.split(/\$\(.*?\)|\$\{?\w+\}?/).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`),
  }))

  it.each(INSTALL_OUTPUT.filter(l => l.kind === 'step' || l.kind === 'ok'))('$kind "$text" comes from public/install', (line) => {
    expect(templates.some(t => t.kind === line.kind && t.re.test(line.text))).toBe(true)
  })
})

describe('live demos', () => {
  it.each([HERO, CONVERSATION, PHONE, BOARD].map(s => [s.id, s] as const))('%s plays in order, inside its loop', (_, script) => {
    expect(scriptProblems(script)).toEqual([])
  })

  it('flags scripts that would play wrong', () => {
    const bad: DemoScript = { id: 'x', timeline: [[500, 1], [400, 3]], loop: 400, final: 4 }
    expect(scriptProblems(bad)).toEqual([
      'x: 400 ms is not after 500 ms',
      'x: step 3 follows step 1',
      'x: the last step is not before the loop end',
      'x: final step 4 is never reached',
    ])
    const slowTyping: DemoScript = { id: 'y', timeline: [[100, 1], [600, 2]], loop: 1000, final: 2, typing: { step: 1, text: 'abc', ms: 900 } }
    expect(scriptProblems(slowTyping)).toEqual(['y: typing runs past step 2'])
    expect(scriptProblems({ ...slowTyping, typing: { step: 3, text: 'abc', ms: 10 } })).toEqual(['y: typing step 3 is never reached'])
  })

  it('hero agent: ready, working once the message is read, your turn at the question, working once answered', () => {
    expect([0, 2, 3, 8, 9, 10, 11].map(agentState)).toEqual(['idle', 'idle', 'working', 'working', 'blocked', 'working', 'working'])
    expect(actionsAt(3)).toEqual([])
    expect(actionsAt(5).map(a => a.cmd)).toEqual(['read src/users.js', 'grep "getUser" src/'])
    expect(actionsAt(11)).toHaveLength(4)
  })

  it('hero answer finishes typing, at the app default speed, before the question shows', () => {
    const at = (s: number) => HERO.timeline.find(([, step]) => step === s)![0]
    const chars = ANSWER.replaceAll('`', '').length
    expect(typeDuration(chars, 'medium') + CATCHUP_MS.medium).toBeLessThanOrEqual(at(9) - at(8))
  })

  it('typing fronts and glyphs match the app typewriter', () => {
    for (const speed of ['off', 'fast', 'medium', 'slow'] as const) {
      for (const total of [0, 1, 39, 120, 900]) {
        for (let ms = -50; ms <= 7000; ms += 37) expect(siteFronts(total, ms, speed)).toEqual(appFronts(total, ms, speed))
      }
    }
    let n = 0
    const rand = () => (n = (n * 7 + 3) % 10) / 10
    const text = 'a b\n  {x}'
    const site = siteGlyphs(text, rand)
    n = 0
    expect(site).toEqual(appGlyphs(text, rand))
    expect([SITE_GLYPH_MS, SITE_TRAIL]).toEqual([APP_GLYPH_MS, APP_TRAIL])
  })

  it('board: the approved task goes Working → Ready to approve → Done, once at each step', () => {
    const where = (step: number, key: string) => BOARD_GROUPS.filter(g => boardAt(step)[g.id].some(c => c.key === key)).map(g => g.id)
    const steps = Array.from({ length: 12 }, (_, i) => i)
    expect(steps.map(s => where(s, COUPONS.key))).toEqual([
      ['working'], ['working'], ['ready'], ['ready'], ['ready'], ['ready'], ['done'], ['done'], ['done'], ['done'], ['done'], ['done'],
    ])
    expect(boardAt(2).ready[0]).toMatchObject({ pr: COUPONS.pr, review: 'pass' })
  })

  it('board: the coordinator’s task appears once answered, in To do, then Working', () => {
    const where = (step: number) => BOARD_GROUPS.filter(g => boardAt(step)[g.id].some(c => c.key === 'SHOP-16')).map(g => g.id)
    expect([0, 9, 10, 11].map(where)).toEqual([[], [], ['todo'], ['working']])
  })

  it('board: every card has a unique key at every step', () => {
    for (let s = 0; s <= 11; s++) {
      const keys = BOARD_GROUPS.flatMap(g => boardAt(s)[g.id].map(c => c.key))
      expect(new Set(keys).size).toBe(keys.length)
    }
  })
})

describe('compact agent list', () => {
  const agent = (name: string, state: DemoAgent['state']): DemoAgent => ({ name, state, agent: 'claude', model: 'Opus 5.5', line: '' })

  it('groups the other agents as the app does: your turn, working, ready (done and idle), no empty group', () => {
    const groups = listGroups([agent('a', 'idle'), agent('b', 'working'), agent('c', 'done')])
    expect(groups.map(g => [g.title, g.list.map(a => a.name)])).toEqual([['Working', ['b']], ['Ready', ['a', 'c']]])
  })

  it('sums up a project\'s tasks without zero counts', () => {
    expect(projectSummary(SHOP.tasks).map(p => p.text)).toEqual(['2 tasks', '2 working'])
    expect(projectSummary([agent('a', 'blocked'), agent('b', 'working'), agent('c', 'idle')]).map(p => p.text))
      .toEqual(['3 tasks', '1 your turn', '1 working'])
  })

  it('every task of the demo project has a unique key and its progress', () => {
    expect(new Set(SHOP.tasks.map(t => t.tag)).size).toBe(SHOP.tasks.length)
    for (const t of SHOP.tasks) expect(t.stats).toMatch(/^\d+% \d+m$/)
  })
})
