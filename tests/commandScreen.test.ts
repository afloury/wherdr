// Régression t-0131 : un skill lancé par « / » (/daily-log) ouvrait le panneau
// « ❯ /DAILY-LOG » avec le texte de l'écran (« ✢ Roosting… »). Écrans
// synthétiques, contenu fictif.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { agentAnswering, isAgentCommand } from '../shared/commandScreen'
import { parseMenu } from '../shared/menuScreen'
import { parseClaudeScreen } from '../server/utils/claudeScreen'
import type { SlashCommand } from '../shared/types'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const RULE = '─'.repeat(60)
const box = ['', RULE, '❯ ', RULE, '  ? for shortcuts']
const screen = (...body: string[]) => ['⏺ Réponse précédente.', '', ...body, ...box].join('\n')

const SKILL_RUNNING = screen('❯ /daily-log', '', '✢ Roosting… (4s · ↓ 120 tokens · esc to interrupt)')
const SKILL_WORKING = screen('❯ /daily-log', '', '* Working…')
const SKILL_DONE = screen('❯ /daily-log', '', '⏺ Journal du jour ajouté : 3 entrées.')
const LOCAL = screen('❯ /cost', '  ⎿  Total cost: $0.12', '     Total duration: 3m')
const catalog: SlashCommand[] = [
  { name: 'cost', desc: 'Show cost', source: 'builtin' },
  { name: 'daily-log', desc: 'Journal', source: 'skill' },
  { name: 'deploy', desc: 'Déployer', source: 'command' },
]

describe('commande « / » : panneau de résultat ou conversation', () => {
  it('skill ou commande personnalisée du catalogue : pas de panneau', () => {
    expect(isAgentCommand('/daily-log', catalog)).toBe(true)
    expect(isAgentCommand('/deploy', catalog)).toBe(true)
    expect(isAgentCommand('/cost', catalog)).toBe(false)
    expect(isAgentCommand('/inconnue', catalog)).toBe(false)
  })

  it('skill en cours (spinner) : l’agent travaille, ni sortie, ni menu, ni commande « ! »', () => {
    for (const s of [SKILL_RUNNING, SKILL_WORKING]) {
      expect(agentAnswering(s, '/daily-log')).toBe(true)
      expect(parseMenu(s)).toBeNull()
      expect(parseClaudeScreen(s, 0)?.shell ?? null).toBeNull()
    }
  })

  it('skill terminé avec réponse : réponse de l’agent, pas une sortie', () => {
    expect(agentAnswering(SKILL_DONE, '/daily-log')).toBe(true)
    expect(parseMenu(SKILL_DONE)).toBeNull()
  })

  it('commande locale : un résultat à montrer', () => {
    expect(agentAnswering(LOCAL, '/cost')).toBe(false)
    expect(parseMenu(LOCAL)).toBeNull()
  })

  it('panneau de réglages plein écran (/usage, sans ligne de commande) : un résultat', () => {
    const s = ['⏺ Ancienne réponse', RULE, '  Settings  Status  Config  Usage', '  Current session  12% used'].join('\n')
    expect(agentAnswering(s, '/usage')).toBe(false)
  })

  it('vraie commande « ! » en cours : bloc « En cours d’exécution », pas un skill', () => {
    const s = parseClaudeScreen(fx('claude-bash-running.txt'), 0)!
    expect(s.shell?.command).toBe('./scripts/build.sh --all')
  })

  it('vrai menu /resume : carte de menu', () => {
    const s = [
      '❯ /resume',
      '▔'.repeat(60),
      '   Resume session',
      '   ❯ Refonte du tableau de bord',
      '     Corriger les tests',
      '     Type to search · Esc to cancel',
    ].join('\n')
    expect(parseMenu(s)?.items.length).toBe(2)
    expect(agentAnswering(s, '/resume')).toBe(false)
  })
})
