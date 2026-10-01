// "Cancel" a queued message: it leaves Claude Code's queue and its
// text comes back into wherdr's input field.
//
// Sequence checked on a real Claude Code (2.1.283): during a turn, ↑
// brings the WHOLE queue back into its input field (one `popAll` operation per
// entry in the transcript). We then empty the field (Ctrl+U erases a
// line, Backspace joins the previous one) and queue the other
// messages again. Traps: Escape and Ctrl+C interrupt the turn; `agent.prompt`
// appends to the text already in the field, hence the check that it is
// empty before and after.
import type { ChatItem, ClaudeQueueEntry } from '../../shared/types'
import { HerdrError } from './herdr'
import { isUploadLine } from './queued'
import { sameMsg } from './transcripts'

// Message text without photo paths (which became images in Claude).
export const msgText = (t: string) => String(t || '').split('\n').filter(l => !isUploadLine(l)).join('\n').trim()

// Content of Claude Code's input field, read from the ANSI screen: the
// "❯" line followed by a non-breaking space (queued messages have a normal
// space), then its continuation lines up to the rule. The grayed-out help text
// ("Press up to edit queued messages") does not count. null: field not found.
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

// Keys that empty a field of `lines` lines.
export function clearKeys(lines: number): string[] {
  const keys: string[] = []
  for (let i = 0; i < Math.min(Math.max(lines, 1) + 2, 200); i++) keys.push('ctrl+u', 'backspace')
  return keys
}

export interface UnqueueDeps {
  screen: () => Promise<string> // visible screen, in ANSI
  keys: (keys: string[]) => Promise<void>
  chat: () => Promise<{ queue: ClaudeQueueEntry[], items: ChatItem[] }>
  prompt: (text: string) => Promise<void> // agent.prompt
  sleep: (ms: number) => Promise<void>
  // Original text (with photo paths) of an entry queued again.
  original?: (text: string) => string
}

const already = () => new HerdrError('already_read', 'Already read by the agent')

// Removes the message `text` from Claude's queue. Returns the messages queued again.
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
  if (!box) throw already() // queue already emptied: ↑ brought nothing back

  // ↑ brings back the whole queue. But if the turn took it in the meantime, it is
  // the history that comes back: our message is then in the conversation.
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

  // Empty the field, checked (two attempts).
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
