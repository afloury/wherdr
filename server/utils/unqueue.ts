// « Annuler » un message en attente : il sort de la file de Claude Code et son
// texte revient dans le champ de saisie de wherdr.
//
// Séquence vérifiée sur un vrai Claude Code (2.1.283) : pendant un tour, ↑
// ramène TOUTE la file dans son champ de saisie (une opération `popAll` par
// entrée dans la transcription). On vide alors le champ (Ctrl+U efface une
// ligne, Retour arrière recolle la précédente) et on remet en file les autres
// messages. Pièges : Échap et Ctrl+C interrompent le tour ; `agent.prompt`
// ajoute au texte déjà présent dans le champ, d'où la vérification qu'il est
// vide avant et après.
import type { ChatItem, ClaudeQueueEntry } from '../../shared/types'
import { HerdrError } from './herdr'
import { isUploadLine } from './queued'
import { sameMsg } from './transcripts'

// Texte du message sans les chemins de photos (devenues des images chez Claude).
export const msgText = (t: string) => String(t || '').split('\n').filter(l => !isUploadLine(l)).join('\n').trim()

// Contenu du champ de saisie de Claude Code, lu dans l'écran ANSI : la ligne
// « ❯ » suivie d'une espace insécable (les messages en file ont une espace
// normale), puis ses lignes de suite jusqu'au trait. Le texte d'aide grisé
// (« Press up to edit queued messages ») ne compte pas. null : champ introuvable.
const ESC = String.fromCharCode(27)
const DIM = new RegExp(`${ESC}\\[2m[^${ESC}]*`, 'g')
const SGR = new RegExp(`${ESC}\\[[0-9;]*[A-Za-z]`, 'g')
export function inputBox(ansi: string): string | null {
  const lines = String(ansi || '').split('\n').map(l => l.replace(/\r$/, ''))
  let at = -1
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.replace(SGR, '').startsWith('❯\u00a0')) { at = i; break }
  if (at < 0) return null
  const out: string[] = []
  for (let i = at; i < lines.length; i++) {
    const plain = lines[i]!.replace(DIM, '').replace(SGR, '')
    if (i > at && /^\s*─{3,}/.test(plain)) break
    out.push((i === at ? plain.slice(2) : plain.replace(/^ {1,2}/, '')).replace(/\u00a0/g, ' ').trimEnd())
  }
  return out.join('\n').trim()
}

// Touches qui vident un champ de `lines` lignes.
export function clearKeys(lines: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < Math.min(Math.max(lines, 1) + 2, 200); i++) keys.push('ctrl+u', 'backspace')
  return keys
}

export interface UnqueueDeps {
  screen: () => Promise<string> // écran visible, en ANSI
  keys: (keys: string[]) => Promise<void>
  chat: () => Promise<{ queue: ClaudeQueueEntry[], items: ChatItem[] }>
  prompt: (text: string) => Promise<void> // agent.prompt
  sleep: (ms: number) => Promise<void>
  // Texte d'origine (avec chemins de photos) d'une entrée remise en file.
  original?: (text: string) => string
}

const already = () => new HerdrError('already_read', 'Already read by the agent')

// Retire de la file de Claude le message `text`. Rend les messages remis en file.
export async function unqueueClaude(d: UnqueueDeps, text: string): Promise<{ requeued: string[] }> {
  const wanted = msgText(text)
  const isIt = (q: ClaudeQueueEntry) => sameMsg(q.text, wanted) || sameMsg(wanted, q.text)
  const before = await d.chat()
  if (!wanted || !before.queue.some(isIt)) throw already()
  const box0 = inputBox(await d.screen())
  if (box0 === null) throw new HerdrError('no_input', 'Agent input field not found')
  if (box0) throw new HerdrError('input_busy', 'The agent’s input field is not empty')

  await d.keys(['up'])
  let box = ''
  for (let i = 0; i < 8 && !box; i++) {
    await d.sleep(150)
    box = inputBox(await d.screen()) || ''
  }
  if (!box) throw already() // file déjà vidée : ↑ n'a rien ramené

  // ↑ ramène toute la file. Mais si le tour l'a prise entre-temps, c'est
  // l'historique qui revient : notre message est alors dans la conversation.
  const saidCount = (items: ChatItem[], q: string) => items.filter(i => (i.role === 'user' || i.role === 'bash') && sameMsg(q, i.text)).length
  const saidNew = (a: ChatItem[], q: string) => saidCount(a, q) > saidCount(before.items, q)
  let after = before
  for (let i = 0; i < 15; i++) {
    after = await d.chat()
    if (!after.queue.some(isIt) || saidNew(after.items, wanted)) break
    await d.sleep(200)
  }
  const read = saidNew(after.items, wanted)
  const popped = read
    ? before.queue.filter(q => !after.queue.some(a => a.text === q.text) && !saidNew(after.items, q.text))
    : before.queue

  // Vider le champ, vérifié (deux essais).
  const lines = box.split('\n').length + popped.reduce((s, q) => s + q.text.split('\n').length, 0)
  for (let i = 0; i < 2; i++) {
    await d.keys(clearKeys(lines))
    await d.sleep(150)
    box = inputBox(await d.screen()) || ''
    if (!box) break
  }
  if (box) throw new HerdrError('clear_failed', 'Agent input not cleared: check its terminal')
  if (read) throw already()

  const requeued: string[] = []
  for (const q of popped) {
    if (isIt(q)) continue
    const t = d.original ? d.original(q.text) : q.text
    await d.prompt(t)
    requeued.push(t)
  }
  return { requeued }
}
