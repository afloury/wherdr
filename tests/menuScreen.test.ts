// Menus interactifs de Claude Code : écrans synthétiques reproduisant la forme
// (et les couleurs ANSI) des vrais, contenu fictif.
import { describe, expect, it } from 'vitest'
import { clickMovesOnly, findEntry, parseMenu, searchKeys, stepToward } from '../shared/menuScreen'

const G = (s: string) => `\x1b[0m\x1b[38;2;153;153;153m${s}\x1b[0m` // gris (descriptions, légende)
const A = (s: string) => `\x1b[0m\x1b[38;2;177;185;249m${s}\x1b[0m` // accent (curseur)
const B = (s: string) => `\x1b[0m\x1b[1m${s}\x1b[0m` // gras (en-tête)
const I = (s: string) => `\x1b[0m\x1b[3m\x1b[38;2;153;153;153m${s}\x1b[0m` // légende en italique
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

describe('parseMenu', () => {
  it('lit le sélecteur /resume : titre, recherche, en-tête, entrées et descriptions grises, légende repliée', () => {
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

  it('lit le texte tapé dans le champ de recherche', () => {
    expect(parseMenu(resume('⌕ tabl'))!.search).toBe('tabl')
  })

  it('/resume en recherche (sans curseur) : texte sous la recherche gardé, légende propre à ce mode', () => {
    const m = parseMenu([TOP, '   Resume session', '   ╭──╮', '   │ ⌕ zzz │', '   ╰──╯', '    No sessions match "zzz".', `     ${G('Type to Search · Enter to select · Esc to clear')}`].join('\n'))!
    expect(m.search).toBe('zzz')
    expect(m.cursor).toBeNull()
    expect(m.lines).toEqual(['No sessions match "zzz".'])
    expect(m.actions).toEqual([{ key: 'enter', label: 'select' }, { key: 'esc', label: 'clear' }])
  })

  it('lit /model : numéros retirés, colonnes en description, flèche de défilement, « +2 models »', () => {
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

  it('lit /mcp : en-tête en gras, icônes d’état gardées', () => {
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

  it('texte sans couleurs : toutes les lignes alignées sur le curseur sont des entrées', () => {
    const plain = resume().replace(/\x1b\[[0-9;]*m/g, '') // eslint-disable-line no-control-regex
    const m = parseMenu(plain)!
    expect(m.title).toBe('Resume session')
    expect(m.items.length).toBe(5)
    expect(m.items[1]!.label).toBe('Refonte du tableau de bord')
  })

  it('menu inconnu sans curseur : titre et légende seulement', () => {
    const m = parseMenu([TOP, '   Some future panel', '   Lorem ipsum dolor sit amet.', '', '   Enter to confirm · Esc to go back'].join('\n'))!
    expect(m.title).toBe('Some future panel')
    expect(m.items).toEqual([])
    expect(m.cursor).toBeNull()
    expect(m.lines).toEqual(['Lorem ipsum dolor sit amet.'])
    expect(m.actions).toEqual([{ key: 'enter', label: 'confirm' }, { key: 'esc', label: 'go back' }])
  })

  it('ignore le champ de saisie au repos, les invites sans Échap et le texte vide', () => {
    expect(parseMenu(['❯ /clear', '─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏸ manual mode on · ← for agents'].join('\n'))).toBeNull()
    expect(parseMenu([TOP, '   Continue?', '   ❯ Yes', '     No', '   Enter to confirm'].join('\n'))).toBeNull()
    expect(parseMenu('')).toBeNull()
    expect(parseMenu(null)).toBeNull()
  })

  it('/permissions : onglets dans le titre, ←/→ en deux boutons', () => {
    const m = parseMenu([TOP, '   Permissions  Recently denied   Allow   Ask   Deny', '   ╭──╮', `   │ ${G('⌕ Search…')} │`, '   ╰──╯', '   ❯ 1. Add a new rule…', '', '   ←/→ to switch · ↓ to select · Esc to cancel'].join('\n'))!
    expect(m.title).toBe('Permissions')
    expect(m.items).toEqual([{ label: 'Add a new rule…', hint: null, cursor: true }])
    expect(m.actions).toEqual([{ key: 'left', label: '← switch' }, { key: 'right', label: '→ switch' }, { key: 'esc', label: 'cancel' }])
  })
})

describe('navigation', () => {
  const m = parseMenu(resume())!
  it('un pas vers l’entrée voulue, Entrée dessus, rien vers un en-tête', () => {
    expect(stepToward(m, 2)).toBe('down')
    expect(stepToward(m, 1)).toBe('enter')
    expect(stepToward(m, 0)).toBeNull()
    expect(stepToward({ ...m, cursor: 2 }, 1)).toBe('up')
  })
  it('retrouve une entrée par son libellé si la liste a bougé', () => {
    expect(findEntry(m, 2, 'Corriger les tests')).toBe(2)
    expect(findEntry(m, 5, 'Corriger les tests')).toBe(2)
    expect(findEntry(m, 2, 'Autre')).toBe(-1)
  })
  it('/model (Entrée = « set as default ») : un clic ne fait que déplacer le curseur', () => {
    expect(clickMovesOnly(parseMenu(model)!)).toBe(true)
    expect(clickMovesOnly(m)).toBe(false)
    expect(clickMovesOnly(parseMenu(mcp)!)).toBe(false)
  })
  it('recherche : efface puis tape lettre par lettre', () => {
    expect(searchKeys('ab', 'c d')).toEqual(['backspace', 'backspace', 'c', 'space', 'd'])
  })
})

// /mcp : la ligne du haut porte un avis de quota ; entrées en groupes (en-têtes
// en gras), icône d'état en tête de libellé, lien d'aide hors de la liste.
const Y = (s: string) => `\x1b[0m\x1b[38;2;255;193;7m${s}\x1b[0m` // jaune (avis, ⚠)
const V = (s: string) => `\x1b[0m\x1b[38;2;78;186;101m${s}\x1b[0m` // vert (✔)
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
  it('reconnaît le menu malgré l\'avis sur la ligne du haut', () => {
    expect(m).not.toBeNull()
    expect(m.title).toBe('Manage MCP servers')
    expect(m.lines).toEqual(['7 servers'])
  })
  it('garde les groupes comme en-têtes et toutes les entrées, dans l\'ordre', () => {
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
  it('met le curseur sur la bonne entrée et y va entrée par entrée', () => {
    expect(m.cursor).toBe(1)
    expect(m.items[m.cursor!]!.label).toBe('✔ demo-browser')
    expect(stepToward(m, 5)).toBe('down')
    expect(stepToward(m, 4)).toBeNull() // en-tête
    expect(stepToward(m, 1)).toBe('enter')
    expect(clickMovesOnly(m)).toBe(false)
    expect(m.actions.map(a => a.key)).toEqual(['enter', 'esc'])
  })
})
