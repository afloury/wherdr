// Claude Code interactive menus: synthetic screens reproducing the shape
// (and ANSI colors) of the real ones, fictional content.
import { describe, expect, it } from 'vitest'
import { clickMovesOnly, findEntry, parseMenu, searchKeys, stepToward } from '../shared/menuScreen'

const G = (s: string) => `\x1b[0m\x1b[38;2;153;153;153m${s}\x1b[0m` // gray (descriptions, legend)
const A = (s: string) => `\x1b[0m\x1b[38;2;177;185;249m${s}\x1b[0m` // accent (curseur)
const B = (s: string) => `\x1b[0m\x1b[1m${s}\x1b[0m` // bold (header)
const I = (s: string) => `\x1b[0m\x1b[3m\x1b[38;2;153;153;153m${s}\x1b[0m` // italic legend
const TOP = A('▔'.repeat(60))
const HISTORY = ['❯ /clear', '❯ /resume', '  ⎿  Resume cancelled']

const resume = (search = `${G('⌕ Search…')}`) => [
  ...HISTORY,
  TOP,
  '   Resume session',
  `   ╭${'─'.repeat(50)}╮`,
  `   │ ${search}${' '.repeat(30)}│`,
  `   ╰${'─'.repeat(50)}╯`,
  `     ${G('demo-project')}`,
  '',
  `   ${A('❯ Refonte du tableau de bord')}`,
  `     ${G('3 seconds ago · main · 244.3KB')}`,
  '',
  '     Corriger les tests',
  `     ${G('19 minutes ago · main · 45.7KB')}`,
  '',
  `     ${G('Ctrl+A to show all projects · Ctrl+B to only show current branch · Space to preview · Ctrl+R to rename · Type ')}`,
  `     ${G('to search · Esc to cancel')}`,
].join('\n')

const model = [
  ...HISTORY,
  TOP,
  `   ${B(A('Select model'))}`,
  '   Switch between models. Your pick becomes the default for new sessions. For other model names,',
  '   specify with --model.',
  '',
  `     1.  Default (recommended)  ${G('Model A · Best for everyday tasks')}`,
  `     2.  Model B                ${G('For complex work')}`,
  `   ${A('❯ 3.  Model C ✔            Fastest for quick answers')}`,
  `   ↓ 4.  Model D                ${G('Efficient for routine tasks')}`,
  `      ${G('… +2 models')}`,
  '',
  `   ${G('○ Effort not supported for Model C')}`,
  '',
  `   ${I('Enter to set as default · s to use this session only · Esc to cancel')}`,
].join('\n')

const mcp = [
  TOP,
  `   ${B(A('Manage MCP servers'))}`,
  `   ${G('3 servers')}`,
  '',
  `     ${B('remote')}`,
  `   ${A('❯ ')}✔ ${A('Docs server       ')}${G('8 tools')}`,
  `     ⚠ Mail server       ${G('needs authentication')}`,
  `     → Show unused connectors      ${G('1 hidden')}`,
  '',
  `   ${G('https://example.com/mcp for help')}`,
  `   ${I('↑/↓ to navigate · Enter to confirm · Esc to cancel')}`,
].join('\n')

// /resume with every project: the list fills the pane and pushes the legend
// below it; each description ends with the folder, sometimes wrapped.
const resumeAll = (opts: { cursor?: boolean, search?: string, paths?: boolean } = {}) => {
  const { cursor = true, search = '', paths = true } = opts
  const entry = (label: string, meta: string, path: string, cur = false) => [
    cur ? `   ${A(`❯ ${label}`)}` : `     ${label}`,
    ...(!paths ? [`     ${G(meta)}`] : path.length > 20 ? [`     ${G(`${meta} · `)}`, `     ${G(path)}`] : [`     ${G(`${meta} · ${path}`)}`]),
    '',
  ]
  return [
    ...HISTORY,
    TOP,
    `   ${B(A(cursor ? 'Resume session (1 of 50)' : 'Resume session'))}`,
    `   ${A(`╭${'─'.repeat(50)}╮`)}`,
    `   ${A('│')} ${A('⌕ ')}${search ? search : G('Search…')}${' '.repeat(30)}${A('│')}`,
    `   ${A(`╰${'─'.repeat(50)}╯`)}`,
    '',
    ...entry('Dashboard redesign', '1 minute ago · HEAD · 46MB', '/srv/demo/project', cursor),
    ...entry('Fix the flaky tests', '2 minutes ago · feature/x · 3.1MB', '/srv/demo/worktrees/feature-x-long-name'),
    ...entry('Write the release notes', '1 hour ago · main · 812KB', '/srv/demo/docs'),
    `   ↓ Translate the settings page`,
  ].join('\n')
}

describe('parseMenu', () => {
  it('reads the /resume picker: title, search, header, entries and gray descriptions, wrapped legend', () => {
    const m = parseMenu(resume())!
    expect(m.title).toBe('Resume session')
    expect(m.search).toBe('')
    expect(m.items).toEqual([
      { label: 'demo-project', hint: null, header: true },
      { label: 'Refonte du tableau de bord', hint: '3 seconds ago · main · 244.3KB', cursor: true },
      { label: 'Corriger les tests', hint: '19 minutes ago · main · 45.7KB' },
    ])
    expect(m.cursor).toBe(1)
    expect(m.actions).toEqual([
      { key: 'ctrl+a', label: 'show all projects' },
      { key: 'ctrl+b', label: 'only show current branch' },
      { key: 'space', label: 'preview' },
      { key: 'esc', label: 'cancel' },
    ])
    expect(m.lines).toEqual([])
  })

  it('reads the text typed in the search field', () => {
    expect(parseMenu(resume('⌕ tabl'))!.search).toBe('tabl')
  })

  it('/resume while searching (no cursor): text below the search kept, legend specific to that mode', () => {
    const m = parseMenu([TOP, '   Resume session', '   ╭──╮', '   │ ⌕ zzz │', '   ╰──╯', '    No sessions match "zzz".', `     ${G('Type to Search · Enter to select · Esc to clear')}`].join('\n'))!
    expect(m.search).toBe('zzz')
    expect(m.cursor).toBeNull()
    expect(m.lines).toEqual(['No sessions match "zzz".'])
    expect(m.actions).toEqual([{ key: 'enter', label: 'select' }, { key: 'esc', label: 'clear' }])
  })

  it('/resume with every project: legend pushed below the pane, still a menu with its keys', () => {
    const m = parseMenu(resumeAll())!
    expect(m.title).toBe('Resume session (1 of 50)')
    expect(m.search).toBe('')
    expect(m.items).toEqual([
      { label: 'Dashboard redesign', hint: '1 minute ago · HEAD · 46MB · /srv/demo/project', cursor: true },
      { label: 'Fix the flaky tests', hint: '2 minutes ago · feature/x · 3.1MB · /srv/demo/worktrees/feature-x-long-name' },
      { label: 'Write the release notes', hint: '1 hour ago · main · 812KB · /srv/demo/docs' },
      { label: 'Translate the settings page', hint: null },
    ])
    expect(m.cursor).toBe(0)
    expect(m.actions).toEqual([
      { key: 'ctrl+a', label: 'only show current repo' },
      { key: 'space', label: 'preview' },
      { key: 'esc', label: 'cancel' },
    ])
    expect(stepToward(m, 2)).toBe('down')
    expect(stepToward(m, 0)).toBe('enter')
    expect(clickMovesOnly(m)).toBe(false)
  })

  it('/resume with every project: a folder cut by the terminal is glued back', () => {
    // Claude wraps a long path at a "-" well before the edge of the pane.
    const path = '/srv/demo/worktrees/a-very-long-folder-name-that-does-not-fit-on-one-line'
    const cut = path.indexOf('-that')
    const m = parseMenu([
      TOP,
      '   Resume session (1 of 3)',
      `   ╭${'─'.repeat(50)}╮`,
      `   │ ${G('⌕ Search…')}${' '.repeat(30)}│`,
      `   ╰${'─'.repeat(50)}╯`,
      '',
      `   ${A('❯ Dashboard redesign')}`,
      `     ${G('1 minute ago · HEAD · 46MB · ')}`,
      `     ${G(path.slice(0, cut))}`,
      `     ${G(path.slice(cut))}`,
    ].join('\n'))!
    expect(m.items).toEqual([{ label: 'Dashboard redesign', hint: `1 minute ago · HEAD · 46MB · ${path}`, cursor: true }])
  })

  it('/resume of the current project with a clipped legend: Ctrl+A shows every project', () => {
    const m = parseMenu(resumeAll({ paths: false }))!
    expect(m.items[0]).toEqual({ label: 'Dashboard redesign', hint: '1 minute ago · HEAD · 46MB', cursor: true })
    expect(m.actions[0]).toEqual({ key: 'ctrl+a', label: 'show all projects' })
  })

  it('/resume with every project while a search is typed: entries listed without a cursor, ↓ first', () => {
    const m = parseMenu(resumeAll({ cursor: false, search: 'notes' }))!
    expect(m.title).toBe('Resume session')
    expect(m.search).toBe('notes')
    expect(m.cursor).toBeNull()
    expect(m.items.map(i => i.label)).toEqual(['Dashboard redesign', 'Fix the flaky tests', 'Write the release notes', 'Translate the settings page'])
    expect(m.items[2]!.hint).toBe('1 hour ago · main · 812KB · /srv/demo/docs')
    expect(m.lines).toEqual([])
    expect(m.actions).toEqual([{ key: 'enter', label: 'select' }, { key: 'esc', label: 'clear' }])
    expect(stepToward(m, 2)).toBe('down')
  })

  it('without a legend nor a search box, a framed screen is not a menu', () => {
    expect(parseMenu([TOP, '   Resume session', '', `   ${A('❯ Dashboard redesign')}`, `     ${G('1 minute ago · HEAD · 46MB')}`].join('\n'))).toBeNull()
  })

  it('reads /model: numbers removed, columns as description, scroll arrow, "+2 models"', () => {
    const m = parseMenu(model)!
    expect(m.title).toBe('Select model')
    expect(m.lines[0]).toMatch(/^Switch between models\. .* specify with --model\.$/)
    expect(m.items.map(i => i.label)).toEqual(['Default (recommended)', 'Model B', 'Model C ✔', 'Model D'])
    expect(m.items[0]!.hint).toBe('Model A · Best for everyday tasks')
    expect(m.cursor).toBe(2)
    expect(m.more).toBe('… +2 models')
    expect(m.search).toBeNull()
    expect(m.actions.map(a => a.key)).toEqual(['enter', 's', 'esc'])
  })

  it('reads /mcp: bold header, state icons kept', () => {
    const m = parseMenu(mcp)!
    expect(m.title).toBe('Manage MCP servers')
    expect(m.items.map(i => [i.label, i.hint, Boolean(i.header)])).toEqual([
      ['remote', null, true],
      ['✔ Docs server', '8 tools', false],
      ['⚠ Mail server', 'needs authentication', false],
      ['→ Show unused connectors', '1 hidden', false],
    ])
    expect(m.cursor).toBe(1)
  })

  it('text without colors: all lines aligned with the cursor are entries', () => {
    const plain = resume().replace(/\x1b\[[0-9;]*m/g, '') // eslint-disable-line no-control-regex
    const m = parseMenu(plain)!
    expect(m.title).toBe('Resume session')
    expect(m.items.length).toBe(5)
    expect(m.items[1]!.label).toBe('Refonte du tableau de bord')
  })

  it('unknown menu without a cursor: title and legend only', () => {
    const m = parseMenu([TOP, '   Some future panel', '   Lorem ipsum dolor sit amet.', '', '   Enter to confirm · Esc to go back'].join('\n'))!
    expect(m.title).toBe('Some future panel')
    expect(m.items).toEqual([])
    expect(m.cursor).toBeNull()
    expect(m.lines).toEqual(['Lorem ipsum dolor sit amet.'])
    expect(m.actions).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'go back' }])
  })

  it('ignores the idle input field, prompts without Escape and empty text', () => {
    expect(parseMenu(['❯ /clear', '─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏸ manual mode on · ← for agents'].join('\n'))).toBeNull()
    expect(parseMenu([TOP, '   Continue?', '   ❯ Yes', '     No', '   Enter to confirm'].join('\n'))).toBeNull()
    expect(parseMenu('')).toBeNull()
    expect(parseMenu(null)).toBeNull()
  })

  it('/permissions: tabs in the title, ←/→ as two buttons', () => {
    const m = parseMenu([TOP, '   Permissions  Recently denied   Allow   Ask   Deny', '   ╭──╮', `   │ ${G('⌕ Search…')} │`, '   ╰──╯', '   ❯ 1. Add a new rule…', '', '   ←/→ to switch · ↓ to select · Esc to cancel'].join('\n'))!
    expect(m.title).toBe('Permissions')
    expect(m.items).toEqual([{ label: 'Add a new rule…', hint: null, cursor: true }])
    expect(m.actions).toEqual([{ key: 'left', label: '← switch' }, { key: 'right', label: '→ switch' }, { key: 'esc', label: 'cancel' }])
  })
})

describe('navigation', () => {
  const m = parseMenu(resume())!
  it('one step towards the wanted entry, Enter on it, nothing towards a header', () => {
    expect(stepToward(m, 2)).toBe('down')
    expect(stepToward(m, 1)).toBe('enter')
    expect(stepToward(m, 0)).toBeNull()
    expect(stepToward({ ...m, cursor: 2 }, 1)).toBe('up')
  })
  it('finds an entry by its label if the list moved', () => {
    expect(findEntry(m, 2, 'Corriger les tests')).toBe(2)
    expect(findEntry(m, 5, 'Corriger les tests')).toBe(2)
    expect(findEntry(m, 2, 'Autre')).toBe(-1)
  })
  it('/model (Enter = "set as default"): a click only moves the cursor', () => {
    expect(clickMovesOnly(parseMenu(model)!)).toBe(true)
    expect(clickMovesOnly(m)).toBe(false)
    expect(clickMovesOnly(parseMenu(mcp)!)).toBe(false)
  })
  it('recherche : efface puis tape lettre par lettre', () => {
    expect(searchKeys('ab', 'c d')).toEqual(['backspace', 'backspace', 'c', 'space', 'd'])
  })
})

// /mcp: the top line carries a quota notice; entries in groups (bold
// headers), state icon at the start of the label, help link outside the list.
const Y = (s: string) => `\x1b[0m\x1b[38;2;255;193;7m${s}\x1b[0m` // yellow (notice, ⚠)
const V = (s: string) => `\x1b[0m\x1b[38;2;78;186;101m${s}\x1b[0m` // green (✔)
const mcpGroups = [
  ...HISTORY,
  `${A('▔'.repeat(7))} ${Y('You\'ve used 80% of your weekly limit · resets Oct 4, 7pm')}${G(' · try /model sonnet ')}${A('▔')}`,
  `   ${B(A('Manage MCP servers'))}`,
  `   ${G('7 servers')}`,
  '',
  `     ${B('User MCPs')} ${G('(~/.demo.json)')}`,
  `   ${A('❯ ')}${V('✔ ')}${A('demo-browser        ')}${G('· connected')}`,
  `     ${V('✔ ')}demo-headless       ${G('· connected')}`,
  `     ${Y('✘ ')}demo-database       ${G('· failed')}`,
  '',
  `     ${B('claude.ai')}`,
  `     ${V('✔ ')}claude.ai Notes     ${G('8 tools')}`,
  `     ${Y('⚠ ')}claude.ai Agenda    ${G('needs authentication')}`,
  '',
  `     ${B('Built-in MCPs')} ${G('(always available)')}`,
  `     ${V('✔ ')}demo-computer       ${G('· connected')}`,
  `     → Show unused connectors      ${G('1 hidden')}`,
  '',
  `   ${G('https://example.com/docs/mcp for help')}`,
  `   ${I('↑/↓ to navigate · Enter to confirm · Esc to cancel')}`,
].join('\n')

describe('parseMenu : /mcp en groupes, avis de quota', () => {
  const m = parseMenu(mcpGroups)!
  it('recognizes the menu despite the notice on the top line', () => {
    expect(m).not.toBeNull()
    expect(m.title).toBe('Manage MCP servers')
    expect(m.lines).toEqual(['7 servers'])
  })
  it('keeps the groups as headers and all entries, in order', () => {
    expect(m.items.map(it => (it.header ? `# ${it.label}` : it.label))).toEqual([
      '# User MCPs (~/.demo.json)',
      '✔ demo-browser',
      '✔ demo-headless',
      '✘ demo-database',
      '# claude.ai',
      '✔ claude.ai Notes',
      '⚠ claude.ai Agenda',
      '# Built-in MCPs (always available)',
      '✔ demo-computer',
      '→ Show unused connectors',
    ])
    expect(m.items[3]!.hint).toBe('· failed')
  })
  it('puts the cursor on the right entry and goes there entry by entry', () => {
    expect(m.cursor).toBe(1)
    expect(m.items[m.cursor!]!.label).toBe('✔ demo-browser')
    expect(stepToward(m, 5)).toBe('down')
    expect(stepToward(m, 4)).toBeNull() // header
    expect(stepToward(m, 1)).toBe('enter')
    expect(clickMovesOnly(m)).toBe(false)
    expect(m.actions.map(a => a.key)).toEqual(['enter', 'esc'])
  })
})
