// Pasted message (<pasted_content>) and queue: bug t-0009, a multi-line
// send stayed "queued" and its reply disappeared.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLines, unwrapPasted } from '../server/utils/transcripts'

const items = parseLines(readFileSync(new URL('./fixtures/claude-queue.jsonl', import.meta.url), 'utf8'), 'claude', 0, '/home/user')
const seq = items.filter(i => i.role === 'user' || i.role === 'assistant').map(i => `${i.role}:${i.text}`)

describe('pasted message', () => {
  it('removes the wrapper, closing tag with id included', () => {
    expect(unwrapPasted('\n\n<pasted_content id="1">\nA\nB\n</pasted_content id="1">\n\n')).toBe('A\nB')
    expect(unwrapPasted('voici :\n<pasted_content>\nA\n</pasted_content>')).toBe('voici :\nA')
    expect(unwrapPasted('<task-notification>x')).toBe('<task-notification>x')
  })

  it('shows the message as a user message, reply in its place', () => {
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
  it('purges handled entries, with or without dequeue, modified text included', () => {
    // "Puis ajoute…": wrapped, no dequeue; "Et le cas
    // négatif ?": rewritten, out at the end of the turn; task
    // notifications are never shown.
    expect(items.queue).toEqual([{ text: 'Toujours en attente', ts: '2026-09-26T09:25:00.000Z' }])
  })
})
