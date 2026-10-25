import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canPickAttempt, parseTaskAttempts, parseTaskDetails } from '../shared/projectsTasks'

const recorded = readFileSync(new URL('./recordings/herdr-projects-1.2.16/details-pick.json', import.meta.url), 'utf8')
describe('CLI attempt details', () => {
  it('reads the installed CLI output and its optional recommendation', () => {
    const d = parseTaskDetails(recorded)
    expect(d.attempts?.map(a => [a.letter, a.agent, a.standing])).toEqual([['A', 'claude', 'passed'], ['B', 'codex', 'passed'], ['C', 'pi', 'out']])
    expect(d.comparison).toMatchObject({ pick: 'B', why: 'The smaller change covers the requirements.', notes: { B: 'Focused changes.' } })
    expect(canPickAttempt(d, 'A')).toBe(true)
    expect(canPickAttempt(d, 'B')).toBe(true)
    for (const letter of ['C', 'D', '', 'b', '--help']) expect(canPickAttempt(d, letter)).toBe(false)
    for (const stage of ['attempts', 'reviewing', 'approval', 'done']) expect(canPickAttempt({ ...d, stage }, 'B')).toBe(false)
    expect(canPickAttempt({ ...d, archived: true }, 'B')).toBe(false)
    expect(parseTaskDetails(JSON.stringify({ task: { id: 'demo/11' } })).attempts).toEqual([])
  })
  it('rejects malformed letters and duplicates and never infers a passed check', () => {
    expect(parseTaskAttempts([null, { letter: 'A', stage: 'tried' }, { letter: 'A', standing: 'passed' }, { letter: 'ZZ' }])).toEqual([{ letter: 'A', agent: '', standing: '', stage: 'tried', stat: '' }])
    const d = parseTaskDetails(recorded)
    for (const standing of ['out', 'works', 'needs', 'waits', 'unknown', '']) expect(canPickAttempt({ ...d, attempts: [{ letter: 'A', agent: '', standing, stage: 'tried', stat: '' }] }, 'A')).toBe(false)
  })
})
