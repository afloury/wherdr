// Commande « ! » longue : la transcription ne l'a qu'à la fin, l'écran de
// Claude Code la montre en cours (bug t-0106 : wherdr affichait « En attente »).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { elapsedMs, parseClaudeScreen } from '../server/utils/claudeScreen'
import { queuedPhase } from '../shared/queuedPhase'

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const NOW = 1_000_000

describe('écran de Claude Code', () => {
  it('commande « ! » en cours : commande, sortie, lignes masquées, début', () => {
    const s = parseClaudeScreen(fx('claude-bash-running.txt'), NOW)!
    expect(s.shell).toEqual({
      command: './scripts/build.sh --all',
      lines: ['step 4 of 30', 'step 5 of 30', 'step 6 of 30', 'step 7 of 30'],
      hidden: 3,
      since: NOW - 7000,
    })
    expect(s.sent).toBe('!./scripts/build.sh --all')
    expect(s.queued).toEqual(['Résume la sortie du build'])
  })

  it('commande sans sortie encore : « Running… (7s) »', () => {
    const s = parseClaudeScreen(fx('claude-bash-starting.txt'), NOW)!
    expect(s.shell).toEqual({ command: 'sleep 12; echo fini', lines: [], hidden: 0, since: NOW - 7000 })
    expect(s.queued).toEqual([])
  })

  it('« ! cmd » envoyé depuis wherdr : Claude affiche « !  cmd » (deux espaces)', () => {
    const s = parseClaudeScreen(fx('claude-bash-starting.txt').replace('! sleep', '!  sleep'), NOW)!
    expect(s.shell && s.shell.command).toBe('sleep 12; echo fini')
    expect(queuedPhase('! sleep 12; echo fini', s)).toBe('running')
  })

  it('commande terminée : plus en cours, mais partie', () => {
    const s = parseClaudeScreen(fx('claude-bash-finished.txt'), NOW)!
    expect(s.shell).toBeNull()
    expect(s.sent).toBe('!./scripts/build.sh --all')
  })

  it('tour normal : message parti (sur deux lignes) et deux messages en file', () => {
    const s = parseClaudeScreen(fx('claude-queued-turn.txt'), NOW)!
    expect(s.shell).toBeNull()
    expect(s.sent).toBe('Corrige le titre de la page\nd\'accueil, puis relance les tests')
    expect(s.queued).toEqual(['Ajoute aussi un test', 'Et mets à jour le changelog'])
  })

  it('écran existant sans commande ni file', () => {
    const s = parseClaudeScreen(fx('claude-working.txt'), NOW)!
    expect(s.shell).toBeNull()
    expect(s.queued).toEqual([])
    expect(parseClaudeScreen('', NOW)).toBeNull()
  })

  it('durées du compteur', () => {
    expect(elapsedMs('7s')).toBe(7000)
    expect(elapsedMs('1m 14s')).toBe(74000)
    expect(elapsedMs('1h 2m 3s')).toBe(3723000)
    expect(elapsedMs('bientôt')).toBeNull()
  })
})

describe('message en attente face à l’écran', () => {
  const running = parseClaudeScreen(fx('claude-bash-running.txt'), NOW)
  const turn = parseClaudeScreen(fx('claude-queued-turn.txt'), NOW)
  const done = parseClaudeScreen(fx('claude-bash-finished.txt'), NOW)

  it('la commande « ! » envoyée est en cours d’exécution, plus en file', () => {
    expect(queuedPhase('! ./scripts/build.sh --all', running)).toBe('running')
    expect(queuedPhase('!./scripts/build.sh   --all', running)).toBe('running')
  })

  it('un message encore dans la file de Claude reste en attente', () => {
    expect(queuedPhase('Résume la sortie du build', running)).toBe('queued')
    expect(queuedPhase('Ajoute aussi un test', turn)).toBe('queued')
    expect(queuedPhase('Et mets à jour le changelog', turn)).toBe('queued')
  })

  it('un message visible comme envoyé n’est plus « en attente »', () => {
    expect(queuedPhase('Corrige le titre de la page d\'accueil, puis relance les tests', turn)).toBe('sent')
    // Commande terminée, pas encore dans la transcription.
    expect(queuedPhase('! ./scripts/build.sh --all', done)).toBe('sent')
  })

  it('pas de confusion : autre texte, début trop court, commande ≠ message', () => {
    expect(queuedPhase('Corrige', turn)).toBe('queued')
    expect(queuedPhase('! ./scripts/deploy.sh', running)).toBe('queued')
    expect(queuedPhase('./scripts/build.sh --all', running)).toBe('queued')
    expect(queuedPhase('Lance les tests unitaires', running)).toBe('queued')
    expect(queuedPhase('Lance les tests', null)).toBe('queued')
  })

  it('photos : les chemins envoyés ne comptent pas, « [Image #1] » non plus', () => {
    const s = { shell: null, sent: '[Image #1] Que vois-tu sur cette capture ?', queued: [] }
    expect(queuedPhase('/home/user/.cache/herdr-web/uploads/a.png\nQue vois-tu sur cette capture ?', s)).toBe('sent')
  })
})
