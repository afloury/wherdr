import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INSTALL_OUTPUT } from '../website/app/utils/installDemo'
import { scriptProblems } from '../website/app/utils/demoScript'
import type { DemoScript } from '../website/app/utils/demoScript'
import { HERO, actionsAt, agentState } from '../website/app/utils/heroDemo'
import { CONVERSATION, DECISION, PHONE, PROJECT, boardAt } from '../website/app/utils/storyDemos'

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
  it.each([HERO, CONVERSATION, PHONE, PROJECT].map(s => [s.id, s] as const))('%s plays in order, inside its loop', (_, script) => {
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

  it('hero agent: ready, working once the message is read, your turn at the question', () => {
    expect([0, 2, 3, 8, 9, 11].map(agentState)).toEqual(['ready', 'ready', 'work', 'work', 'turn', 'turn'])
    expect(actionsAt(3)).toEqual([])
    expect(actionsAt(5).map(a => a.tool)).toEqual(['read', 'grep'])
    expect(actionsAt(11)).toHaveLength(4)
  })

  it('project board: the thread moves from In progress to To test once, the decision leaves when sent', () => {
    const where = (step: number) => {
      const b = boardAt(step)
      return (['test', 'progress'] as const).filter(k => b[k].some(i => i.title === 'Coupon codes'))
    }
    expect([0, 1, 2, 3, 4, 8].map(where)).toEqual([['progress'], ['progress'], ['progress'], ['progress'], ['test'], ['test']])
    expect(boardAt(2).progress.find(i => i.title === 'Coupon codes')?.state).toBe('ready')
    expect(boardAt(6).decide.map(i => i.title)).toEqual([DECISION])
    expect(boardAt(7).decide).toEqual([])
  })
})
