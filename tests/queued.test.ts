// Message collé (<pasted_content>) et file d'attente : bug t-0009, un envoi
// multi-lignes restait « en attente » et sa réponse disparaissait.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLines, unwrapPasted } from '../server/utils/transcripts'
import { queuedDone } from '../server/utils/queued'
import type { ChatItem } from '../shared/types'

const items = parseLines(readFileSync(new URL('./fixtures/claude-queue.jsonl', import.meta.url), 'utf8'), 'claude', 0, '/home/user')
const seq = items.filter(i => i.role === 'user' || i.role === 'assistant').map(i => `${i.role}:${i.text}`)

describe('message collé', () => {
  it('retire l’enveloppe, balise de fermeture avec id comprise', () => {
    expect(unwrapPasted('\n\n<pasted_content id="1">\nA\nB\n</pasted_content id="1">\n\n')).toBe('A\nB')
    expect(unwrapPasted('voici :\n<pasted_content>\nA\n</pasted_content>')).toBe('voici :\nA')
    expect(unwrapPasted('<task-notification>x')).toBe('<task-notification>x')
  })

  it('montre le message comme un message de l’utilisateur, réponse à sa place', () => {
    expect(seq).toEqual([
      'user:Vérifie le calcul',
      'assistant:Le calcul est prêt.',
      'assistant:J\'attends ton choix.',
      'user:- Le total est correct\n- <b>Arrondi</b> à ajuster',
      'assistant:Je corrige l\'arrondi.',
      'user:Le bouton est trop petit.',
      'assistant:Je regarde le bouton.',
      'user:Puis ajoute un test\npour zéro',
      'assistant:Test zéro ajouté.',
      'user:Et pour -1, stp ?',
      'assistant:Cas négatif ajouté.',
    ])
    expect(items.find(i => i.text.startsWith('Le bouton'))!.images).toBe(1)
  })
})

describe('file de Claude', () => {
  it('purge les entrées traitées, avec ou sans dequeue, texte modifié compris', () => {
    // « Puis ajoute… » : enveloppée, pas de dequeue ; « Et le cas
    // négatif ? » : réécrite, sortie en fin de tour ; les notifications
    // de tâches ne sont jamais affichées.
    expect(items.queue).toEqual([{ text: 'Toujours en attente', ts: '2026-09-26T09:25:00.000Z' }])
  })
})

describe('envoi en attente de wherdr', () => {
  const at = Date.parse('2026-09-26T09:22:40.000Z')
  const q = { id: 'x', at, text: '- Le total est correct\n- <b>Arrondi</b> à ajuster' }
  const now = at + 60000

  it('est rapproché du message collé', () => {
    expect(queuedDone(q, items, false, now)).toBe(true)
  })

  it('texte modifié : traité une fois l’agent au repos et la réponse écrite', () => {
    const other = { ...q, text: 'texte que Claude a réécrit' }
    expect(queuedDone(other, items, false, now)).toBe(false)
    expect(queuedDone(other, items, true, now)).toBe(true)
    const noReply: ChatItem[] = [{ role: 'user', text: 'réécrit', ts: '2026-09-26T09:22:52.000Z' }]
    expect(queuedDone(other, noReply, true, now)).toBe(false)
  })

  it('reste en attente tant que rien n’est écrit après l’envoi', () => {
    const late = { ...q, text: 'autre chose', at: Date.parse('2026-09-26T09:30:00.000Z') }
    expect(queuedDone(late, items, true, late.at + 1000)).toBe(false)
    expect(queuedDone(late, items, true, late.at + 2 * 3600e3)).toBe(true)
  })
})
