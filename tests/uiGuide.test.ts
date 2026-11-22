// WHR-206: the role texts' "Showing instead of telling": each role gets only
// its own tools, and every example parses as the chat or the CLI reads it.
// Alfred's is the section of docs/alfred.md that its AGENTS.md points to: parsed here too.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { uiGuide, uiGuideRows, type UiRole } from '../shared/pm/uiGuide'
import { parseCommand } from '../shared/pm/coordinator'
import { parseAlfredCommand } from '../shared/pm/alfredCli'
import { parseStatusBlock } from '../shared/statusBlock'
import { parseWherdrBlock } from '../app/utils/markdown'
import { UI_ACTIONS } from '../shared/uiActions'

const cases: [UiRole, { key?: string }][] = [['task', {}], ['coordinator', { key: 'WEB' }]]

// The text an agent reads: each fenced block and each command in it, copied as is.
function parsedExamples(text: string) {
  const blocks = [...text.matchAll(/```wherdr\n([\s\S]*?)\n```/g)].map(m => m[1]!)
  const cmds = [...text.matchAll(/`wherdr (alfred|pm) ([^`]+)`/g)].map(m => ({ cli: m[1]!, rest: m[2]! }))
  for (const b of blocks) expect(parseWherdrBlock(b) ?? parseStatusBlock(b), b).toBeTruthy()
  for (const { cli, rest } of cmds) {
    const argv = rest.split(' ')
    expect('error' in (cli === 'pm' ? parseCommand(argv) : parseAlfredCommand(argv)), rest).toBe(false)
  }
  return { blocks, cmds }
}

describe('uiGuide', () => {
  it.each(cases)('every %s example parses as written in the text', (role, o) => {
    const { blocks, cmds } = parsedExamples(uiGuide(role, o).join('\n'))
    expect(blocks.length + cmds.length).toBe(uiGuideRows(role, o).length)
  })

  it('gives each role only its own tools', () => {
    const text = (role: UiRole, o = {}) => uiGuide(role, o).join('\n')
    expect(text('task')).not.toMatch(/wherdr (pm|alfred)|status /)
    expect(text('task')).toContain('choices "')
    expect(text('coordinator', { key: 'WEB' })).toMatch(/wherdr pm ui action step WEB-12/)
    expect(text('coordinator')).not.toMatch(/wherdr alfred|setting set/)
  })

  it('states the wake, refusal and "never say done" rules', () => {
    const t = uiGuide('coordinator').join('\n')
    expect(t).toMatch(/In a wake: `wherdr` blocks only/)
    expect(t).toMatch(/give the in-app link in text\. Never retry/)
    expect(t).toMatch(/never say a button's action is done/)
  })
})

// Alfred's AGENTS.md carries the block syntax and the rules, and points here for each
// situation with its example: the table cannot go stale, every example is parsed.
describe('docs/alfred.md, "Showing instead of telling"', () => {
  const doc = fs.readFileSync(path.resolve(__dirname, '../docs/alfred.md'), 'utf8')
  const section = doc.split('\n## ').find(s => s.startsWith('Showing instead of telling\n'))!

  it('has every example parsing as the chat or the CLI reads it, and a row for each button action', () => {
    const { blocks, cmds } = parsedExamples(section)
    expect(blocks.map(b => b.split(/\s/)[0])).toEqual(['choices', 'questions', 'choices', 'task', 'status'])
    for (const start of ['ui open --target ', 'setting set ', 'project guards ']) expect(cmds.some(c => c.cli === 'alfred' && c.rest.startsWith(start)), start).toBe(true)
    for (const start of [...UI_ACTIONS.map(a => `ui action ${a} `), 'ui show shots ']) expect(cmds.some(c => c.cli === 'pm' && c.rest.startsWith(start)), start).toBe(true)
  })

  it('states the wake, refusal and "never say done" rules', () => {
    expect(section).toMatch(/In a wake[^\n]*`wherdr` blocks only/)
    expect(section).toMatch(/gives? the in-app link in text/)
    expect(section).toMatch(/never says? a button's action is done/)
  })
})
