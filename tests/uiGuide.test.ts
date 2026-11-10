// WHR-206: the role texts' "Showing instead of telling": each role gets only
// its own tools, and every example parses as the chat or the CLI reads it.
import { describe, expect, it } from 'vitest'
import { uiGuide, uiGuideRows, type UiRole } from '../shared/pm/uiGuide'
import { parseCommand } from '../shared/pm/coordinator'
import { parseAlfredCommand } from '../shared/pm/alfredCli'
import { parseStatusBlock } from '../shared/statusBlock'
import { parseWherdrBlock } from '../app/utils/markdown'

const cases: [UiRole, { pm?: boolean, key?: string }][] = [['task', {}], ['coordinator', { key: 'WEB' }], ['alfred', {}], ['alfred', { pm: true }]]

describe('uiGuide', () => {
  it.each(cases)('every %s example parses', (role, o) => {
    for (const { use } of uiGuideRows(role, o)) {
      if ('block' in use) expect(parseWherdrBlock(use.block) ?? parseStatusBlock(use.block), use.block).toBeTruthy()
      else expect('error' in (use.cli === 'pm' ? parseCommand(use.argv) : parseAlfredCommand(use.argv)), use.argv.join(' ')).toBe(false)
    }
  })

  it('gives each role only its own tools', () => {
    const text = (role: UiRole, o = {}) => uiGuide(role, o).join('\n')
    expect(text('task')).not.toMatch(/wherdr (pm|alfred)|status /)
    expect(text('task')).toContain('choices "')
    expect(text('coordinator', { key: 'WEB' })).toMatch(/wherdr pm ui action step WEB-12/)
    expect(text('coordinator')).not.toMatch(/wherdr alfred|setting set/)
    expect(text('alfred')).toContain('wherdr alfred setting set replyStyle list --propose')
    expect(text('alfred')).not.toContain('wherdr pm')
    expect(text('alfred', { pm: true })).toContain('wherdr pm ui show shots')
  })

  it('states the wake, refusal and "never say done" rules', () => {
    const t = uiGuide('coordinator').join('\n')
    expect(t).toMatch(/In a wake: `wherdr` blocks only/)
    expect(t).toMatch(/give the in-app link in text\. Never retry/)
    expect(t).toMatch(/never say a button's action is done/)
  })
})
